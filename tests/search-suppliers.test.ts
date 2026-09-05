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
    assert.equal(calls, 0);
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
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][OFFICIAL]")));
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][FINAL]")));
    assert.ok(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][SUMMARY]")));
    assert.equal(logs.some(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][EXTERNAL]")), false);
    assert.equal(logs.join("\n").includes("secret-test-key"), false);
    assert.equal(logs.join("\n").includes("x".repeat(1201)), false, "logged snippets must be truncated");
    const summaryLine = logs.find(line => line.startsWith("[SUPPLIER_DIAGNOSTICS][SUMMARY]")) ?? "";
    assert.match(summaryLine, /"primaryRawCount":1/);
    assert.match(summaryLine, /"additionalRawCount":1/);
    assert.match(summaryLine, /"combinedRawCount":3/);
    assert.match(summaryLine, /"additionalTriggerReason":"resolved unique suppliers 1 is below 8"/);
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

test("fewer than eight resolved identities trigger all three bounded discovery passes with maxResults 10", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  const discoveryPayloads: Payload[] = [];
  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    if (!payload.include_domains && !payload.query?.startsWith('"')) {
      discoveryPayloads.push(payload);
      if (discoveryPayloads.length === 1) return tavily([
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
    assert.equal(discoveryPayloads.length, 3, "discovery is bounded to primary, commercial, and complementary passes");
    assert.ok(discoveryPayloads.every(payload => payload.max_results === 10), "every discovery pass requests 10 results");
    assert.match(discoveryPayloads[1].query ?? "", /different commercial intent/);
    assert.equal(response.responseBody.results.length, 2);
    assert.equal(response.responseBody.results.filter(result => result.supplierDomain === "gemini.ua").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});

test("a product page reaches identity resolution before supplier-specific product gating", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  let calls = 0;
  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const payload = JSON.parse(String(init?.body)) as Payload;
    if (calls === 1) return tavily([{
      title: "Wholesale partnership",
      url: "https://exact-coffee.example/products/offer",
      content: "Компанія: Exact Coffee. Наша компанія — постачальник для HoReCa та B2B клієнтів оптом.",
      score: 0.9,
    }]);
    if (!payload.include_domains) return tavily([]);
    return tavily([{
      title: "Exact Coffee beans and delivery",
      url: "https://exact-coffee.example/catalog/beans",
      content: "Кава в зернах для кав'ярень. Доставка по Україні.",
      score: 0.9,
    }]);
  };
  try {
    const response = await invoke();
    assert.equal(calls, 4);
    assert.equal(response.responseBody.results.length, 1);
    assert.equal(response.responseBody.results[0].title, "Exact Coffee");
    assert.equal(response.responseBody.results[0].product, "Кава в зернах");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});

test("eight resolved identities in primary discovery stop expansion", async () => {
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

test("additional discovery reaching eight resolved identities skips complementary discovery", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  const discoveryPayloads: Payload[] = [];
  process.env.TAVILY_API_KEY = "test-key";
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    if (!payload.include_domains && !payload.query?.startsWith('"')) {
      discoveryPayloads.push(payload);
      const offset = discoveryPayloads.length === 1 ? 0 : 7;
      const count = discoveryPayloads.length === 1 ? 7 : 1;
      return tavily(Array.from({ length: count }, (_, index) => ({
        title: `Coffee Supplier ${offset + index + 1}`,
        url: `https://supplier-${offset + index + 1}.example/wholesale`,
        content: "Наша компанія — постачальник. Кава в зернах оптом для бізнесу.",
        score: 0.9,
      })));
    }
    const domain = payload.include_domains?.[0] ?? "unknown.example";
    return tavily([{ title: "Delivery", url: `https://${domain}/delivery`, content: "Кава в зернах. Доставка по Україні.", score: 0.8 }]);
  };
  try {
    const response = await invoke();
    assert.equal(discoveryPayloads.length, 2);
    assert.ok(discoveryPayloads.every(payload => payload.max_results === 10));
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
    assert.equal(calls, 3, "marketplace-only supplier performs the three bounded discovery passes without enrichment calls");
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

test("pipeline separates discovery identity and supplier-specific facts without cross-supplier contamination", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = "test-key";
  let discoveryCalls = 0;
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    if (!payload.include_domains && !payload.query?.startsWith('"')) {
      discoveryCalls += 1;
      if (discoveryCalls > 1) return tavily([]);
      return tavily([
        {
          title: "Купити каву оптом", url: "https://royal-life.ua/catalog/beans",
          content: "Компанія: Royal Life. Наша компанія — постачальник для HoReCa. Кава в зернах оптом. MOQ 30 кг. Ціна 900 грн/кг. Доставка в Україну.", score: 0.96,
        },
        {
          title: "Royal Life wholesale", url: "https://shop.royal-life.ua/wholesale",
          content: "Royal Life — виробник. Кава в зернах гуртом для бізнесу.", score: 0.88,
        },
        {
          title: "Coffee Town", url: "https://coffee-town.pl/b2b",
          content: "Coffee Town company supplies whole bean coffee wholesale for business customers.", score: 0.9,
        },
        {
          title: "Local Bean", url: "https://local-bean.ua/wholesale",
          content: "Local Bean — постачальник кави в зернах оптом. Юридична адреса: Київ, Україна.", score: 0.85,
        },
        {
          title: "Кава в зернах | Prom.ua", url: "https://prom.ua/ua/fest-coffee/p123",
          content: "Продавець: !FEST Coffee Mission | Кава в зернах для HoReCa оптом. MOQ 50 кг. Ціна 1000 грн/кг. Доставка по Україні.", score: 0.82,
        },
        { title: "постачальник", url: "https://supplier.example/category", content: "Кава в зернах оптом.", score: 0.8 },
        { title: "Top coffee suppliers", url: "https://media.example/articles/top", content: "Royal Life and Coffee Town sell coffee.", score: 0.75 },
      ]);
    }
    if (payload.include_domains?.[0] === "coffee-town.pl") return tavily([{
      title: "Coffee Town B2B", url: "https://coffee-town.pl/delivery",
      content: "Coffee Town whole bean coffee. MOQ 10 kg. Wholesale price 700 грн/кг. We ship to Ukraine.", score: 0.9,
    }]);
    if (payload.include_domains?.[0] === "local-bean.ua") return tavily([]);
    if (payload.query?.startsWith('"Local Bean"')) return tavily([{
      title: "Royal Life profile", url: "https://directory.example/royal-life",
      content: "Royal Life sells coffee, MOQ 5 kg, and delivers to Ukraine.", score: 0.7,
    }]);
    return tavily([]);
  };
  try {
    const response = await invoke(buildSupplierSearchRequest("Шукаю постачальника кави в зернах в Україні для невеликої кав'ярні, MOQ до 20 кг"));
    assert.equal(discoveryCalls, 3);
    assert.deepEqual(response.responseBody.results.map(item => item.title).sort(), ["!FEST Coffee Mission", "Coffee Town", "Royal Life"].sort());
    const royal = response.responseBody.results.find(item => item.title === "Royal Life");
    const coffeeTown = response.responseBody.results.find(item => item.title === "Coffee Town");
    assert.equal(royal?.moq, "30 кг");
    assert.equal(royal?.price, "900 грн/кг");
    assert.equal(coffeeTown?.moq, "10 кг");
    assert.equal(coffeeTown?.price, "700 грн/кг");
    assert.equal(response.responseBody.results.some(item => item.title === "постачальник"), false);
    assert.equal(response.responseBody.results.some(item => item.title === "Local Bean"), false, "location in Ukraine and Royal Life facts must not confirm Local Bean delivery");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});

test("supplier found during enrichment is promoted once without contaminating the current supplier", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = "test-key";
  let calls = 0;
  let discoveryCalls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const payload = JSON.parse(String(init?.body)) as Payload;
    if (!payload.include_domains && !payload.query?.startsWith('"')) {
      discoveryCalls += 1;
      return discoveryCalls === 1 ? tavily([{
        title: "Alpha Coffee", url: "https://alpha-coffee.example/b2b",
        content: "Компанія: Alpha Coffee. Кава в зернах оптом для HoReCa.", score: 0.95,
      }]) : tavily([]);
    }
    if (payload.include_domains?.[0] === "alpha-coffee.example") return tavily([]);
    if (payload.query?.startsWith('"Alpha Coffee"')) return tavily([{
      title: "BUNO | Кава для бізнесу", url: "https://buno.example/wholesale",
      content: "Компанія: BUNO. Виробник кави в зернах оптом для HoReCa. MOQ 50 кг. Оптова ціна 1100 грн/кг. Доставка по Україні.", score: 0.9,
    }]);
    if (payload.include_domains?.[0] === "buno.example") return tavily([{
      title: "Coffeeton", url: "https://coffeeton.example/wholesale",
      content: "Компанія: Coffeeton. Кава в зернах оптом для HoReCa. Доставка по Україні.", score: 0.8,
    }]);
    return tavily([]);
  };
  try {
    const response = await invoke(buildSupplierSearchRequest("Шукаю постачальника кави в зернах в Україні, MOQ до 20 кг"));
    assert.equal(discoveryCalls, 3, "promotion does not add discovery passes");
    assert.equal(calls, 6, "one promoted generation has a finite enrichment budget");
    assert.deepEqual(response.responseBody.results.map(item => item.title), ["BUNO"]);
    const buno = response.responseBody.results[0];
    assert.equal(buno.moq, "50 кг", "verified actual MOQ survives a lower buyer preference");
    assert.equal(buno.price, "1100 грн/кг");
    assert.equal(response.responseBody.results.some(item => item.title === "Alpha Coffee"), false,
      "supplier B delivery and facts cannot make supplier A eligible");
    assert.equal(response.responseBody.results.some(item => item.title === "Coffeeton"), false,
      "evidence found while enriching a promoted supplier is not recursively promoted");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = originalKey;
  }
});
