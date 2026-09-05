import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/search-suppliers.ts";
import { buildSupplierSearchRequest } from "../shared/supplier-search-criteria.ts";

type Payload = { query?: string; include_domains?: string[]; max_results?: number };

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
    assert.equal(calls.length, 4);
    assert.match(calls[1].query ?? "", /different commercial intent/);
    assert.match(calls[2].query ?? "", /complementary commercial intent/);
    assert.deepEqual(calls[3].include_domains, ["exact-coffee.example"]);
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
    assert.equal(response.responseBody.results.length, 0, "unconfirmed delivery must not reach the API response");
    assert.equal(calls, 5);
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
    assert.equal(calls, 3);
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
    assert.equal(calls, 4, "diagnostics must not add calls beyond three bounded discovery passes");
    assert.equal("diagnostics" in response.responseBody, false);
    assert.equal(JSON.stringify(response.responseBody).includes("SUPPLIER_DIAGNOSTICS"), false);
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][PRIMARY]")));
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][ADDITIONAL]")));
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][COMPLEMENTARY]")));
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][OFFICIAL]")));
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][FINAL]")));
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][SUMMARY]")));
    assert.equal(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][EXTERNAL]")), false);
    assert.equal(logs.join("\n").includes("secret-test-key"), false);
    assert.equal(logs.join("\n").includes("x".repeat(1201)), false, "logged snippets must be truncated");
    const summaryLine = logs.find(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][SUMMARY]")) ?? "";
    assert.match(summaryLine, /"primaryRawCount":1/);
    assert.match(summaryLine, /"additionalRawCount":1/);
    assert.match(summaryLine, /"complementaryRawCount":1/);
    assert.match(summaryLine, /"combinedRawCount":3/);
    assert.match(summaryLine, /"additionalTriggerReason":"viable unique suppliers 1 is below target 8"/);
    assert.match(summaryLine, /"complementaryTriggerReason":"viable unique suppliers 1 is below target 8"/);
    assert.match(summaryLine, /"discoveryCallCount":3/);
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
    if (!payload.include_domains && payload.query?.includes("different commercial intent")) return tavily([]);
    if (calls.length === 1) return tavily([supplier("https://exact-coffee.example/catalog/coffee")]);
    if (payload.include_domains) return tavily([{
      title: "Exact Coffee catalog", url: "https://exact-coffee.example/catalog",
      content: "Whole bean coffee for cafes.", score: 0.8,
    }]);
    return tavily([{
      title: "Exact Coffee delivery profile", url: "https://trusted-profile.example/exact-coffee",
      content: "Exact Coffee (exact-coffee.example) supplies whole bean coffee and ships to Україна.", score: 0.7,
    }]);
  };
  try {
    const response = await invoke(buildSupplierSearchRequest(query));
    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 5);
    assert.match(calls[0].query ?? "", /Use Ukrainian market terminology: оптом гуртом постачальник/);
    assert.match(calls[0].query ?? "", /^Кава в зернах /);
    assert.match(calls[0].query ?? "", /deliver to Україна; supplier location may be any country/iu);
    assert.doesNotMatch(calls[0].query ?? "", /20 кг/iu);
    assert.match(calls[3].query ?? "", /buyer maximum MOQ до 20 кг/);
    assert.match(calls[3].query ?? "", /delivery shipping Україна/);
    assert.match(calls[4].query ?? "", /до 20 кг Україна shipping delivery/);
    assert.equal(calls[3].query, "Кава в зернах wholesale B2B catalog MOQ minimum order price buyer maximum MOQ до 20 кг delivery shipping Україна company legal address");
    assert.equal(calls[4].query, "\"Exact Coffee\" \"exact-coffee.example\" Кава в зернах buyer maximum MOQ до 20 кг Україна shipping delivery wholesale distributor");
    assert.equal(response.responseBody.results.length, 1);
    assert.equal(response.responseBody.results[0].moq, null, "requested MOQ must not become supplier MOQ");
    assert.equal(response.responseBody.results[0].supplierLocation, null, "delivery region must not become supplier location");
    assert.equal((response.responseBody.results[0].delivery as { status: string }).status, "confirmed");
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

test("fewer than eight viable identities run all three bounded passes and dedupe identities across them", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  const discoveryQueries: string[] = [];
  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    if (!payload.include_domains && !payload.query?.startsWith('"')) {
      discoveryQueries.push(payload.query ?? "");
      if (discoveryQueries.length === 1) return tavily([
        supplier("https://gemini.ua/coffee", 0.9),
        supplier("https://store.gemini.ua/wholesale", 0.8),
      ]);
      return tavily([
        supplier("https://store.gemini.ua/catalog", 0.7),
        supplier("https://second-coffee.example/wholesale", 0.85),
      ]);
    }
    const domain = payload.include_domains?.[0] ?? "unknown.example";
    return tavily([{
      title: "Кава в зернах — доставка",
      url: `https://${domain}/delivery`,
      content: "Кава в зернах. Доставка по Україні.",
      score: 0.9,
    }]);
  };
  try {
    const response = await invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(discoveryQueries.length, 3, "discovery must stop after the complementary pass");
    assert.match(discoveryQueries[1], /different commercial intent/);
    assert.match(discoveryQueries[2], /complementary commercial intent/);
    assert.equal(response.responseBody.results.length, 2);
    assert.equal(response.responseBody.results.filter(result => result.supplierDomain === "gemini.ua").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});

test("eight viable unique suppliers from primary skip both expansion passes", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  let discoveryCalls = 0;
  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    if (!payload.include_domains && !payload.query?.startsWith('"')) {
      discoveryCalls += 1;
      return tavily(Array.from({ length: 8 }, (_, index) => ({
        title: `Coffee Supplier ${index + 1}`,
        url: `https://supplier-${index + 1}.example/wholesale`,
        content: "Наша компанія — постачальник. Кава в зернах оптом для бізнесу.",
        score: 0.9 - index / 100,
      })));
    }
    const domain = payload.include_domains?.[0] ?? "unknown.example";
    return tavily([{
      title: "Кава в зернах — доставка", url: `https://${domain}/delivery`,
      content: "Кава в зернах. Доставка по Україні.", score: 0.8,
    }]);
  };
  try {
    const response = await invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(discoveryCalls, 1);
    assert.equal(response.responseBody.results.length, 8);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});

test("one additional pass runs when primary is below eight and reaching eight skips complementary", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  const discoveryPayloads: Payload[] = [];
  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    if (!payload.include_domains && !payload.query?.startsWith('"')) {
      discoveryPayloads.push(payload);
      const offset = discoveryPayloads.length === 1 ? 0 : 4;
      return tavily(Array.from({ length: 4 }, (_, index) => ({
        title: `Coffee Supplier ${offset + index + 1}`,
        url: `https://supplier-${offset + index + 1}.example/wholesale`,
        content: "Наша компанія — постачальник. Кава в зернах оптом для бізнесу.",
        score: 0.9,
      })));
    }
    const domain = payload.include_domains?.[0] ?? "unknown.example";
    return tavily([{
      title: "Кава в зернах — доставка", url: `https://${domain}/delivery`,
      content: "Кава в зернах. Доставка по Україні.", score: 0.8,
    }]);
  };
  try {
    const response = await invoke();
    assert.equal(response.statusCode, 200);
    assert.equal(discoveryPayloads.length, 2, "exactly one additional discovery call should run");
    assert.equal(discoveryPayloads[0].max_results, 10);
    assert.equal(discoveryPayloads[1].max_results, 10);
    assert.match(discoveryPayloads[1].query ?? "", /different commercial intent/);
    assert.equal(response.responseBody.results.length, 8);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});

test("RoyalLife reaches enrichment and remains eligible with actual MOQ 30 кг above requested 20 кг", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  const query = "Шукаю постачальника кави в зернах в Україні для невеликої кав'ярні, MOQ до 20 кг";
  let calls = 0;
  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const payload = JSON.parse(String(init?.body)) as Payload;
    if (calls === 1) return tavily([{
      title: "Кава оптом від українського виробника Royal Life",
      url: "https://royal-life.ua/kava-optom",
      content: "Цікавить кава, купити оптом яку пропонує постачальник Роял Лайф? Мінімальний обсяг для отримання оптових умов у Royal Life починається від 30 кг. Стабільні поставки для бізнесу. Компанія забезпечує доставку по Україні через Нову Пошту.",
      score: 0.95,
    }]);
    if (!payload.include_domains) return tavily([]);
    return tavily([]);
  };
  try {
    const response = await invoke(buildSupplierSearchRequest(query));
    assert.equal(response.statusCode, 200);
    assert.equal(calls, 4);
    assert.equal(response.responseBody.results.length, 1);
    assert.equal(response.responseBody.results[0].moq, "від 30 кг");
    assert.notEqual(response.responseBody.results[0].moq, "20 кг");
    assert.equal((response.responseBody.results[0].delivery as { status: string }).status, "confirmed");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});

test("marketplace B2B seller remains eligible from supplier-specific evidence despite preference mismatch", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  const query = "Шукаю постачальника кави в зернах в Україні, MOQ до 20 кг";
  let calls = 0;
  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return tavily([{
      title: "Кава в зернах Premium | Продавець: Company A",
      url: "https://rozetka.com.ua/ua/company-a-coffee/p3",
      content: "Продавець: Company A | Кава в зернах для бізнесу оптом. MOQ 50 кг. Ціна 1 100,00 грн. Доступна з доставкою Розетка по всій території України.",
      score: 0.9,
    }]);
    return tavily([]);
  };
  try {
    const response = await invoke(buildSupplierSearchRequest(query));
    assert.equal(response.statusCode, 200);
    assert.equal(calls, 3, "marketplace-only supplier performs all three bounded discovery passes");
    assert.equal(response.responseBody.results.length, 1);
    assert.equal(response.responseBody.results[0].title, "Company A");
    assert.equal(response.responseBody.results[0].supplierDomain, null);
    assert.equal(response.responseBody.results[0].moq, "50 кг");
    assert.equal(response.responseBody.results[0].price, "1 100,00 грн");
    assert.equal((response.responseBody.results[0].delivery as { sourceType: string }).sourceType, "marketplace");
    assert.deepEqual(response.responseBody.results[0].evidenceSources, [{
      url: "https://rozetka.com.ua/ua/company-a-coffee/p3", sourceType: "marketplace",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});
