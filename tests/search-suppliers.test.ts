import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/search-suppliers.ts";

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

async function invoke() {
  let statusCode = 0;
  let responseBody: unknown;
  await handler(
    { method: "POST", body: { query: "кава в зернах оптом", deliveryRegion: "Ukraine" } },
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
