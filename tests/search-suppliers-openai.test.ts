import assert from "node:assert/strict";
import test from "node:test";
import handler, { normalizeOpenAISuppliers, toProductionSupplier } from "../api/search-suppliers-openai.ts";

async function invoke(method = "POST", body: unknown = { query: "coffee beans", deliveryRegion: "Ukraine" }) {
  let statusCode = 0;
  let responseBody: unknown;
  const headers: Record<string, string> = {};
  await handler({ method, body }, {
    status(code) { statusCode = code; return this; },
    setHeader(name, value) { headers[name] = value; return this; },
    json(value) { responseBody = value; },
  });
  return { statusCode, responseBody, headers };
}

test("only POST is accepted and input fields are validated", async () => {
  const get = await invoke("GET");
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.Allow, "POST");
  assert.equal((await invoke("POST", "{" )).statusCode, 400);
  assert.equal((await invoke("POST", {})).statusCode, 400);
  assert.equal((await invoke("POST", { query: "coffee", deliveryRegion: " " })).statusCode, 400);
});

test("missing server-side OpenAI key returns a safe configuration error", async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await invoke();
    assert.equal(result.statusCode, 500);
    assert.deepEqual(result.responseBody, { error: "Server configuration error: OpenAI is not configured." });
  } finally {
    if (original !== undefined) process.env.OPENAI_API_KEY = original;
  }
});

test("Responses API uses web search and structured output without Tavily", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "openai-test-secret";
  let requestUrl = "";
  let payload: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ output_text: JSON.stringify({ suppliers: [{
      name: "Example Roaster", website: "https://supplier.example", location: "Poland",
      product: { displayValue: "Whole bean coffee", sourceUrl: "https://supplier.example/coffee" },
      delivery: { status: "confirmed", displayValue: "Ships to Ukraine", sourceUrl: "https://supplier.example/shipping", evidenceText: "We ship orders to Ukraine." },
      price: { displayValue: null, type: "unknown", sourceUrl: null, evidenceText: null },
      sources: ["https://supplier.example/coffee", "not-a-url"],
    }] }) }), { status: 200 });
  };
  try {
    const result = await invoke();
    assert.equal(result.statusCode, 200);
    assert.equal(requestUrl, "https://api.openai.com/v1/responses");
    assert.equal(payload.model, "gpt-5-mini");
    assert.deepEqual(payload.tools, [{ type: "web_search", search_context_size: "high" }]);
    assert.equal(payload.input, JSON.stringify({ query: "coffee beans", deliveryRegion: "Ukraine" }));
    assert.match(String(payload.instructions), /bounded evidence workflow/);
    assert.doesNotMatch(String(payload.instructions), /MOQ|minimum order/i);
    assert.match(String(payload.instructions), /Classify a price as wholesale only when that exact price/);
    assert.equal((payload.text as { format: { type: string; strict: boolean } }).format.type, "json_schema");
    assert.equal((payload.text as { format: { strict: boolean } }).format.strict, true);
    assert.equal(JSON.stringify(payload).includes("Tavily"), false);
    const row = (result.responseBody as { results: Array<Record<string, unknown>> }).results[0];
    assert.equal("moq" in row, false);
    assert.equal(row.price, null);
    assert.equal(row.score, 0.9);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("normalization cannot turn unsupported delivery or buyer price limits into supplier facts", () => {
  const suppliers = normalizeOpenAISuppliers({ suppliers: [{
    name: "Unverified Supplier", website: null, location: null,
    product: { displayValue: "Coffee", sourceUrl: null },
    delivery: { status: "confirmed", displayValue: "Ships to Ukraine", sourceUrl: null, evidenceText: "Ships to Ukraine" },
    price: { displayValue: "$10 buyer maximum", type: "wholesale", sourceUrl: null, evidenceText: "Buyer maximum price $10" },
    sources: [],
  }] });
  assert.deepEqual(suppliers, []);
});

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    name: "Generic B2B Supplier", website: "https://supplier.example", location: "Ukraine",
    product: { displayValue: "Coffee beans", sourceUrl: "https://supplier.example/coffee" },
    delivery: { status: "confirmed", displayValue: "Ships to Ukraine", sourceUrl: "https://supplier.example/shipping", evidenceText: "We ship to Ukraine." },
    price: { displayValue: null, type: "unknown", sourceUrl: null, evidenceText: null },
    sources: [], ...overrides,
  };
}

test("listed starting price is not promoted to wholesale but an explicit wholesale price is", () => {
  const [listed, wholesale] = normalizeOpenAISuppliers({ suppliers: [
    candidate({ price: { displayValue: "from 535 UAH/kg", type: "wholesale", sourceUrl: "https://supplier.example/catalog", evidenceText: "Wholesale solutions for cafes. Listed prices from 535 UAH/kg." } }),
    candidate({ name: "Tiered Supplier", price: { displayValue: "480 UAH/kg", type: "wholesale", sourceUrl: "https://supplier.example/b2b", evidenceText: "Wholesale price for orders of 10–20 kg: 480 UAH/kg." } }),
  ] }, "Ukraine");

  assert.equal(listed.price.type, "base");
  assert.equal(listed.price.displayValue, "from 535 UAH/kg");
  assert.equal(wholesale.price.type, "wholesale");
  assert.equal(wholesale.price.displayValue, "480 UAH/kg");
});

test("market presence and supplier location do not confirm delivery, but explicit shipping does", () => {
  const [shipping] = normalizeOpenAISuppliers({ suppliers: [
    candidate({ delivery: { status: "confirmed", displayValue: "Ukraine market", sourceUrl: "https://supplier.example/about", evidenceText: "A Ukrainian supplier serving HoReCa customers in Ukraine." } }),
    candidate({ name: "Foreign Supplier", location: "Poland", delivery: { status: "confirmed", displayValue: "Ships to Ukraine", sourceUrl: "https://supplier.example/shipping", evidenceText: "We ship wholesale orders to Ukraine." } }),
  ] }, "Ukraine");

  assert.deepEqual(shipping.delivery, { status: "confirmed", displayValue: "Ships to Ukraine", sourceUrl: "https://supplier.example/shipping" });
});

test("buyer constraints and unrelated charges cannot become supplier price", () => {
  const [supplier] = normalizeOpenAISuppliers({ suppliers: [candidate({
    delivery: { status: "confirmed", displayValue: "Ships to Ukraine", sourceUrl: "https://supplier.example/shipping", evidenceText: "We ship to Ukraine." },
    price: { displayValue: "100 UAH", type: "listed", sourceUrl: "https://supplier.example/shipping", evidenceText: "Delivery cost: 100 UAH." },
  })] }, "Ukraine");

  assert.equal("moq" in supplier, false);
  assert.deepEqual(supplier.price, { displayValue: null, type: "unknown", sourceUrl: null });
});

test("production adapter preserves evidence and computes a dynamic Match score", () => {
  const supplier = normalizeOpenAISuppliers({ suppliers: [candidate({
    location: null,
    delivery: { status: "confirmed", displayValue: "Ships to Ukraine", sourceUrl: "https://supplier.example/shipping", evidenceText: "We ship to Ukraine." },
  })] }, "Ukraine")[0];
  const result = toProductionSupplier(supplier, "Ukraine");
  assert.equal(result.title, "Generic B2B Supplier");
  assert.equal(result.product, "Coffee beans");
  assert.equal(result.delivery.status, "confirmed");
  assert.equal(result.delivery.region, "Ukraine");
  assert.equal(result.score, 0.85);
  assert.equal("moq" in result, false);
});

test("upstream failures are returned without secret-bearing details", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "never-leak-this";
  globalThis.fetch = async () => { throw new Error("never-leak-this upstream detail"); };
  try {
    const result = await invoke();
    assert.equal(result.statusCode, 502);
    assert.equal(JSON.stringify(result.responseBody).includes("never-leak-this"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("malformed OpenAI output fails safely", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "openai-test-secret";
  globalThis.fetch = async () => new Response(JSON.stringify({ output_text: "not json" }), { status: 200 });
  try {
    const result = await invoke();
    assert.equal(result.statusCode, 502);
    assert.deepEqual(result.responseBody, { error: "Supplier web search is temporarily unavailable." });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});
