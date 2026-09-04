import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/search-suppliers.ts";
import { buildSupplierSearchRequest } from "../shared/supplier-search-criteria.ts";

type Payload = { query?: string; include_domains?: string[] };

function tavily(results: unknown[]): Response {
  return new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function supplier(url: string, score = 0.9) {
  return {
    title: "Exact Coffee — кава в зернах оптом",
    url,
    content: "Наша компанія — постачальник. Кава в зернах для кав'ярень оптом.",
    score,
  };
}

async function invoke(body: unknown = { query: "кава в зернах оптом", deliveryRegion: "Ukraine" }) {
  let statusCode = 0;
  let responseBody: unknown;
  await handler(
    { method: "POST", body },
    {
      status(code) { statusCode = code; return this; },
      setHeader() { return this; },
      json(body) { responseBody = body; },
    },
  );
  return { statusCode, responseBody: responseBody as { results: Array<Record<string, unknown>> } };
}

test("qualification happens before hostname dedupe and enrichment retains one canonical supplier", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  const calls: Payload[] = [];
  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    calls.push(payload);
    if (calls.length === 1) return tavily([
      { title: "Top 10 suppliers", url: "https://exact-coffee.example/blog/top", content: "Top 10 coffee suppliers", score: 1 },
      supplier("https://exact-coffee.example/catalog/coffee"),
      supplier("https://www.exact-coffee.example/wholesale", 0.8),
    ]);
    return tavily([{
      title: "Доставка — Exact Coffee", url: "https://exact-coffee.example/delivery",
      content: "Кава в зернах. Доставка по Україні.", score: 0.9,
    }]);
  };
  try {
    const response = await invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(response.responseBody.results.length, 1);
    assert.equal(response.responseBody.results[0].url, "https://exact-coffee.example/catalog/coffee");
    assert.deepEqual((response.responseBody.results[0].delivery as { status: string }).status, "confirmed");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].include_domains, ["exact-coffee.example"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});

test("official and external verification failures do not fail the whole supplier search", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  let calls = 0;
  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return tavily([supplier("https://exact-coffee.example/catalog/coffee")]);
    throw new Error("verification unavailable");
  };
  try {
    const response = await invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(response.responseBody.results.length, 1);
    assert.equal((response.responseBody.results[0].delivery as { status: string }).status, "not_confirmed");
    assert.equal(response.responseBody.results[0].moq, null);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});

test("a qualified supplier irrelevant to the requested product is rejected", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  let calls = 0;
  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async () => {
    calls += 1;
    return tavily([supplier("https://exact-coffee.example/catalog/coffee")]);
  };
  try {
    let statusCode = 0;
    let body: unknown;
    await handler(
      { method: "POST", body: { query: "постачальник чаю", deliveryRegion: "Ukraine" } },
      { status(code) { statusCode = code; return this; }, setHeader() { return this; }, json(value) { body = value; } },
    );
    assert.equal(statusCode, 200);
    assert.deepEqual((body as { results: unknown[] }).results, []);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});

test("diagnostics are env-gated, structured, bounded, and absent from the API response", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalKey = process.env.TAVILY_API_KEY;
  const originalDiagnostics = process.env.SUPPLIER_SEARCH_DIAGNOSTICS;
  const logs: string[] = [];
  let calls = 0;
  process.env.TAVILY_API_KEY = "secret-test-key";
  process.env.SUPPLIER_SEARCH_DIAGNOSTICS = "true";
  console.log = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return tavily([supplier("https://exact-coffee.example/catalog/coffee")]);
    return tavily([{
      title: "Exact Coffee delivery",
      url: "https://exact-coffee.example/delivery",
      content: `Whole bean coffee. We ship to Ukraine. ${"x".repeat(1600)}`,
      score: 0.8,
    }]);
  };
  try {
    const response = await invoke();
    assert.equal(calls, 2, "diagnostics must not add Tavily calls");
    assert.equal("diagnostics" in response.responseBody, false);
    assert.equal(JSON.stringify(response.responseBody).includes("SUPPLIER_DIAGNOSTICS"), false);
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][PRIMARY]")));
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][OFFICIAL]")));
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][FINAL]")));
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][SUMMARY]")));
    assert.equal(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][EXTERNAL]")), false);
    assert.equal(logs.join("\n").includes("secret-test-key"), false);
    assert.equal(logs.join("\n").includes("x".repeat(1201)), false, "logged snippets must be truncated");
    const summaryLine = logs.find(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][SUMMARY]")) ?? "";
    assert.match(summaryLine, /"primaryRawCount":1/);
    assert.match(summaryLine, /"officialCalls":1/);
    assert.match(summaryLine, /"externalCalls":0/);
    assert.match(summaryLine, /"returnedCount":1/);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
    if (originalDiagnostics === undefined) delete process.env.SUPPLIER_SEARCH_DIAGNOSTICS;
    else process.env.SUPPLIER_SEARCH_DIAGNOSTICS = originalDiagnostics;
  }
});

test("control criteria reach backend and target both enrichment queries without becoming supplier facts", async () => {
  const query = "Шукаю постачальника кави в зернах в Україні для невеликої кав'ярні, MOQ до 20 кг";
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalKey = process.env.TAVILY_API_KEY;
  const originalDiagnostics = process.env.SUPPLIER_SEARCH_DIAGNOSTICS;
  const calls: Payload[] = [];
  const logs: string[] = [];
  process.env.TAVILY_API_KEY = "test-key";
  process.env.SUPPLIER_SEARCH_DIAGNOSTICS = "true";
  console.log = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    calls.push(payload);
    if (calls.length === 1) return tavily([supplier("https://exact-coffee.example/catalog/coffee")]);
    if (calls.length === 2) return tavily([{
      title: "Exact Coffee catalog", url: "https://exact-coffee.example/catalog",
      content: "Whole bean coffee for cafes.", score: 0.8,
    }]);
    return tavily([]);
  };
  try {
    const response = await invoke(buildSupplierSearchRequest(query));
    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 3);
    assert.match(calls[1].query ?? "", /buyer maximum MOQ до 20 кг/);
    assert.match(calls[1].query ?? "", /delivery shipping Україна/);
    assert.match(calls[2].query ?? "", /до 20 кг Україна shipping delivery/);
    assert.equal(response.responseBody.results[0].moq, null, "requested MOQ must not become supplier MOQ");
    assert.equal(response.responseBody.results[0].supplierLocation, null, "delivery region must not become supplier location");
    assert.equal((response.responseBody.results[0].delivery as { status: string }).status, "not_confirmed");
    const primaryLog = logs.find(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][PRIMARY]")) ?? "";
    assert.match(primaryLog, /"criteria":\{"product":"Кава в зернах","deliveryRegion":"Україна","maxMoq":\{"value":20/);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
    if (originalDiagnostics === undefined) delete process.env.SUPPLIER_SEARCH_DIAGNOSTICS;
    else process.env.SUPPLIER_SEARCH_DIAGNOSTICS = originalDiagnostics;
  }
});
