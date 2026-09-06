import assert from "node:assert/strict";
import test from "node:test";
import handler, { normalizeOpenAISuppliers } from "../api/search-suppliers-openai.ts";

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
      delivery: { status: "confirmed", displayValue: "Ships to Ukraine", sourceUrl: "https://supplier.example/shipping" },
      moq: { value: null, unit: null, displayValue: null, sourceUrl: null },
      price: { displayValue: null, type: "unknown", sourceUrl: null },
      sources: ["https://supplier.example/coffee", "not-a-url"],
    }] }) }), { status: 200 });
  };
  try {
    const result = await invoke();
    assert.equal(result.statusCode, 200);
    assert.equal(requestUrl, "https://api.openai.com/v1/responses");
    assert.equal(payload.model, "gpt-5-mini");
    assert.deepEqual(payload.tools, [{ type: "web_search" }]);
    assert.equal((payload.text as { format: { type: string; strict: boolean } }).format.type, "json_schema");
    assert.equal((payload.text as { format: { strict: boolean } }).format.strict, true);
    assert.equal(JSON.stringify(payload).includes("Tavily"), false);
    const row = (result.responseBody as { results: Array<Record<string, unknown>> }).results[0];
    assert.deepEqual(row.moq, { value: null, unit: null, displayValue: null, sourceUrl: null });
    assert.deepEqual(row.price, { displayValue: null, type: "unknown", sourceUrl: null });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("normalization cannot turn unsupported delivery or buyer limits into supplier facts", () => {
  const [supplier] = normalizeOpenAISuppliers({ suppliers: [{
    name: "Unverified Supplier", website: null, location: null,
    product: { displayValue: "Coffee", sourceUrl: null },
    delivery: { status: "confirmed", displayValue: "Ships to Ukraine", sourceUrl: null },
    moq: { value: 20, unit: "kg", displayValue: "20 kg", sourceUrl: null },
    price: { displayValue: "$10 buyer maximum", type: "wholesale", sourceUrl: null },
    sources: [],
  }] });
  assert.deepEqual(supplier.delivery, { status: "not_confirmed", displayValue: null, sourceUrl: null });
  assert.deepEqual(supplier.moq, { value: null, unit: null, displayValue: null, sourceUrl: null });
  assert.deepEqual(supplier.price, { displayValue: null, type: "unknown", sourceUrl: null });
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
