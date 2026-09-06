import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/search-suppliers-openai-multistep.ts";

async function invoke(body: unknown = { query: "coffee beans, preferred MOQ up to 20 kg", deliveryRegion: "Ukraine" }) {
  let statusCode = 0;
  let responseBody: unknown;
  const headers: Record<string, string> = {};
  await handler({ method: "POST", body }, {
    status(code) { statusCode = code; return this; },
    setHeader(name, value) { headers[name] = value; return this; },
    json(value) { responseBody = value; },
  });
  return { statusCode, responseBody, headers };
}

function supplier(candidateId: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    candidateId, name, website: "https://model-name.example", location: "Ukraine",
    product: { displayValue: "Whole bean coffee", sourceUrl: `https://${candidateId}.example/coffee` },
    delivery: { status: "confirmed", displayValue: "Ships to Ukraine", sourceUrl: `https://${candidateId}.example/shipping`, evidenceText: "We ship orders to Ukraine." },
    moq: { value: null, unit: null, displayValue: null, sourceUrl: null, evidenceText: null },
    price: { displayValue: null, type: "unknown", sourceUrl: null, evidenceText: null },
    sources: [],
    ...overrides,
  };
}

test("discovery and identity-bound verification use exactly two separate OpenAI requests", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-secret";
  const payloads: Array<Record<string, unknown>> = [];
  const outputs = [
    { candidates: [
      { name: "Discovered Roaster", website: "https://roaster.example", evidenceUrls: ["https://roaster.example/about", "invalid"] },
      { name: "Location Only", website: "https://local.example", evidenceUrls: [] },
      { name: "High MOQ Supplier", website: "https://high.example", evidenceUrls: [] },
      { name: "Tiered Supplier", website: "https://tier.example", evidenceUrls: [] },
    ] },
    { suppliers: [
      supplier("candidate-1", "Attempted Rename"),
      supplier("candidate-2", "Location Only", {
        delivery: { status: "confirmed", displayValue: "Ukraine", sourceUrl: "https://local.example/about", evidenceText: "Ukrainian HoReCa supplier operating in Ukraine." },
        moq: { value: 1, unit: "kg", displayValue: "1 kg", sourceUrl: "https://local.example/coffee", evidenceText: "Available in 1 kg bags." },
      }),
      supplier("candidate-3", "High MOQ Supplier", {
        moq: { value: 50, unit: "kg", displayValue: "50 kg", sourceUrl: "https://high.example/terms", evidenceText: "Minimum wholesale order: 50 kg." },
        price: { displayValue: "600 UAH/kg", type: "wholesale", sourceUrl: "https://high.example/catalog", evidenceText: "Coffee is listed at 600 UAH/kg. Wholesale service is available." },
      }),
      supplier("candidate-4", "Tiered Supplier", {
        price: { displayValue: "480 UAH/kg", type: "wholesale", sourceUrl: "https://tier.example/b2b", evidenceText: "Wholesale price for orders of 10–20 kg: 480 UAH/kg." },
      }),
      supplier("unrelated-99", "Unrelated Replacement"),
    ] },
  ];
  globalThis.fetch = async (_input, init) => {
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ output_text: JSON.stringify(outputs[payloads.length - 1]) }), { status: 200 });
  };

  try {
    const response = await invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(payloads.length, 2);
    assert.equal((payloads[0].text as { format: { name: string } }).format.name, "supplier_discovery");
    assert.equal((payloads[1].text as { format: { name: string } }).format.name, "supplier_verification");
    assert.match(String(payloads[0].instructions), /DISCOVERY ONLY/);
    assert.match(String(payloads[1].instructions), /TARGETED VERIFICATION ONLY/);
    const verificationInput = JSON.parse(String(payloads[1].input)) as { candidates: Array<{ candidateId: string; name: string }> };
    assert.deepEqual(verificationInput.candidates.map(({ candidateId, name }) => ({ candidateId, name })), [
      { candidateId: "candidate-1", name: "Discovered Roaster" },
      { candidateId: "candidate-2", name: "Location Only" },
      { candidateId: "candidate-3", name: "High MOQ Supplier" },
      { candidateId: "candidate-4", name: "Tiered Supplier" },
    ]);

    const body = response.responseBody as {
      results: Array<{ name: string; website: string; moq: { value: number | null }; price: { type: string; displayValue: string | null } }>;
      diagnostics: Record<string, unknown>;
    };
    assert.deepEqual(body.results.map(row => row.name), ["Discovered Roaster", "High MOQ Supplier", "Tiered Supplier"]);
    assert.equal(body.results[0].website, "https://roaster.example/");
    assert.equal(body.results[0].moq.value, null);
    assert.equal(body.results[0].price.displayValue, null);
    assert.equal(body.results[1].moq.value, 50, "actual MOQ above buyer preference is retained");
    assert.equal(body.results[1].price.type, "listed", "generic product price is not promoted to wholesale");
    assert.equal(body.results[2].price.type, "wholesale");
    assert.deepEqual(body.diagnostics, {
      discoveryCalls: 1, verificationCalls: 1, discoveredCandidateCount: 4, verifiedCandidateCount: 4,
      rejectedByDeliveryCount: 1, finalEligibleCount: 3, withVerifiedMoqCount: 1, withPriceCount: 2,
      missingFacts: { product: 0, delivery: 1, moq: 3, price: 2 },
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("empty discovery is bounded to one call and does not run verification", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-secret";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ output_text: JSON.stringify({ candidates: [] }) }), { status: 200 });
  };
  try {
    const response = await invoke();
    assert.equal(calls, 1);
    assert.equal((response.responseBody as { diagnostics: { verificationCalls: number } }).diagnostics.verificationCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("invalid product evidence prevents eligibility and malformed URLs remain unsupported", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-secret";
  const outputs = [
    { candidates: [{ name: "Candidate", website: "javascript:bad", evidenceUrls: ["not-a-url"] }] },
    { suppliers: [supplier("candidate-1", "Candidate", {
      product: { displayValue: "Coffee", sourceUrl: "not-a-url" },
      delivery: { status: "confirmed", displayValue: "Ships to Ukraine", sourceUrl: "not-a-url", evidenceText: "Ships to Ukraine" },
      moq: { value: 20, unit: "kg", displayValue: "20 kg", sourceUrl: "https://candidate.example/search", evidenceText: "Buyer requested maximum 20 kg." },
    })] },
  ];
  let call = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ output_text: JSON.stringify(outputs[call++]) }), { status: 200 });
  try {
    const response = await invoke();
    const body = response.responseBody as { results: unknown[]; diagnostics: { finalEligibleCount: number; missingFacts: { product: number; moq: number } } };
    assert.deepEqual(body.results, []);
    assert.equal(body.diagnostics.finalEligibleCount, 0);
    assert.equal(body.diagnostics.missingFacts.product, 1);
    assert.equal(body.diagnostics.missingFacts.moq, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});
