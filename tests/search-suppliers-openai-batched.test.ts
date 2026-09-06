import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import handler, { makeVerificationBatches, normalizeDiscovery, normalizeVerification } from "../api/search-suppliers-openai-batched.ts";

const discovered = (count: number) => normalizeDiscovery({ candidates: Array.from({ length: count }, (_, index) => ({
  candidateId: `model-${Math.random()}`, name: `Supplier ${index + 1}`, website: `https://supplier${index + 1}.example`, discoveryEvidenceUrls: [`https://supplier${index + 1}.example/about`],
})) });
const evidence = (status: string, displayValue: string | null, evidenceText: string | null, sourceUrl: string | null, rejectionReason: string | null = null) => ({ status, displayValue, evidenceText, sourceUrl, rejectionReason });
const verifiedRow = (candidate = discovered(1)[0]) => ({
  candidateId: candidate.candidateId, name: candidate.name, website: candidate.website, supplierLocation: "Poland", identityStatus: "accepted", identityRejectionReason: null,
  product: evidence("confirmed", "Coffee beans", "This supplier offers coffee beans.", `${candidate.website}/coffee`),
  delivery: evidence("confirmed", "Ships to Ukraine", "We ship orders to Ukraine.", `${candidate.website}/shipping`),
  price: { ...evidence("not_found", null, null, null), type: "unknown" }, sources: [],
});

test("discovery accepts fewer than ten, caps at ten, and assigns stable IDs", () => {
  assert.equal(discovered(4).length, 4); assert.equal(discovered(12).length, 10);
  assert.deepEqual(discovered(3).map(c => c.candidateId), ["candidate-01", "candidate-02", "candidate-03"]);
  assert.equal(discovered(1)[0] && "moq" in discovered(1)[0], false);
});

test("verification uses fixed batches of at most three and expected call counts", () => {
  for (const [count, calls] of [[0, 1], [1, 2], [3, 2], [4, 3], [9, 4], [10, 5]]) {
    const batches = makeVerificationBatches(discovered(count));
    assert.ok(batches.every(batch => batch.length <= 3)); assert.equal(1 + batches.length, calls);
  }
});

test("verification cannot introduce suppliers or migrate candidate identities", () => {
  const candidates = discovered(2); const introduced = { ...verifiedRow(candidates[0]), candidateId: "candidate-99", name: "Intruder" };
  const migrated = { ...verifiedRow(candidates[1]), name: "Unrelated Company", website: "https://unrelated.example" };
  const result = normalizeVerification({ candidates: [verifiedRow(candidates[0]), introduced, migrated] }, candidates, "Ukraine");
  assert.equal(result.length, 2); assert.equal(result[0].eligible, true); assert.equal(result[1].identityStatus, "rejected"); assert.equal(result[1].eligible, false);
  assert.deepEqual(result.map(row => row.name), candidates.map(row => row.name));
});

test("supplier facts cannot borrow evidence from another domain", () => {
  const candidate = discovered(1)[0]; const row = verifiedRow(candidate);
  row.product.sourceUrl = "https://unrelated.example/coffee";
  row.delivery.sourceUrl = "https://unrelated.example/shipping";
  const [result] = normalizeVerification({ candidates: [row] }, [candidate], "Ukraine");
  assert.equal(result.product.status, "not_confirmed"); assert.equal(result.delivery.status, "not_confirmed"); assert.equal(result.eligible, false);
});

test("product evidence and explicit regional delivery are hard eligibility requirements while price is optional", () => {
  const candidates = discovered(3);
  const noProduct = { ...verifiedRow(candidates[0]), product: evidence("confirmed", "Coffee", null, `${candidates[0].website}/coffee`) };
  const presence = { ...verifiedRow(candidates[1]), delivery: evidence("confirmed", "Ukraine", "Located in Ukraine and serving customers in this market; imported into Ukraine.", `${candidates[1].website}/about`) };
  const explicit = verifiedRow(candidates[2]);
  const result = normalizeVerification({ candidates: [noProduct, presence, explicit] }, candidates, "Ukraine");
  assert.equal(result[0].eligible, false); assert.equal(result[0].product.status, "not_confirmed");
  assert.equal(result[1].delivery.status, "not_confirmed"); assert.equal(result[1].eligible, false);
  assert.equal(result[2].delivery.status, "confirmed"); assert.equal(result[2].price.status, "not_found"); assert.equal(result[2].eligible, true);
});

test("invalid prices are rejected and generic prices are not promoted to wholesale", () => {
  const candidates = discovered(4); const cases = [
    ["Shipping fee is $10", "$10"], ["Minimum order value is $100", "$100"], ["Buyer's maximum price is $8", "$8"], ["Coffee beans cost $12 per kg", "$12/kg"],
  ];
  const rows = cases.map(([claim, display], i) => ({ ...verifiedRow(candidates[i]), price: { ...evidence("accepted", display, claim, `${candidates[i].website}/price`), type: "wholesale" } }));
  const result = normalizeVerification({ candidates: rows }, candidates, "Ukraine");
  assert.deepEqual(result.slice(0, 3).map(row => row.price.status), ["rejected", "rejected", "rejected"]);
  assert.equal(result[3].price.status, "accepted"); assert.equal(result[3].price.type, "listed");
});

async function invoke() { let statusCode = 0; let body: unknown; await handler({ method: "POST", body: { query: "coffee", deliveryRegion: "Ukraine" } }, {
  status(code) { statusCode = code; return this }, setHeader() { return this }, json(value) { body = value },
}); return { statusCode, body } }

test("mocked endpoint performs discovery plus batches and returns complete secret-free diagnostics", async () => {
  const originalFetch = globalThis.fetch; const originalKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "unit-test-secret";
  let calls = 0; globalThis.fetch = async (_input, init) => {
    calls++; const payload = JSON.parse(String(init?.body)); assert.equal(payload.tools[0].type, "web_search"); assert.match(payload.instructions, /Do not research or return MOQ/);
    const input = JSON.parse(payload.input);
    const output = calls === 1 ? { candidates: Array.from({ length: 7 }, (_, i) => ({ candidateId: `x${i}`, name: `Supplier ${i + 1}`, website: `https://supplier${i + 1}.example`, discoveryEvidenceUrls: [] })) }
      : { candidates: input.candidates.map((candidate: ReturnType<typeof discovered>[number]) => verifiedRow(candidate)) };
    return new Response(JSON.stringify({ output_text: JSON.stringify(output) }));
  };
  try {
    const response = await invoke(); const result = response.body as any;
    assert.equal(response.statusCode, 200); assert.equal(calls, 4); assert.deepEqual(result.diagnostics.calls, { total: 4, discovery: 1, verification: 3 });
    assert.equal(result.diagnostics.discovery.discoveredCandidateCount, 7); assert.equal(result.diagnostics.verificationBatches.length, 3);
    assert.ok(result.diagnostics.verificationBatches.every((batch: any) => batch.attempted && batch.completed && batch.candidateIds.length <= 3));
    assert.equal(result.diagnostics.candidates.length, 7); assert.equal(result.diagnostics.summary.returnedSupplierCount, 7);
    assert.equal(JSON.stringify(result).includes("unit-test-secret"), false); assert.equal(JSON.stringify(result).match(/moq/i), null);
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey }
});

test("errors do not expose secrets and no OpenAI call occurs without a key", async () => {
  const originalFetch = globalThis.fetch; const originalKey = process.env.OPENAI_API_KEY; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("secret-in-upstream-error") };
  try {
    delete process.env.OPENAI_API_KEY; assert.equal((await invoke()).statusCode, 500); assert.equal(calls, 0);
    process.env.OPENAI_API_KEY = "secret-in-upstream-error"; const response = await invoke(); assert.equal(response.statusCode, 502); assert.equal(JSON.stringify(response.body).includes("secret-in-upstream-error"), false);
  } finally { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey }
});

test("experiment is isolated and production Tavily endpoint and app request remain unchanged", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8"); const page = await readFile(new URL("../src/pages/OpenAIBatchedExperimentPage/OpenAIBatchedExperimentPage.tsx", import.meta.url), "utf8");
  const production = await readFile(new URL("../src/pages/SupplierSearchPage/SupplierSearchPage.tsx", import.meta.url), "utf8");
  assert.match(app, /path="\/openai-batched-experiment"/); assert.match(page, /\/api\/search-suppliers-openai-batched/); assert.doesNotMatch(page, /\/api\/search-suppliers['"]/);
  assert.match(production, /\/api\/search-suppliers/); assert.doesNotMatch(production, /search-suppliers-openai-batched/);
});
