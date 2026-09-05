import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichSupplier,
  extractVerifiedEnrichment,
  mergeEnrichment,
  rankAndFilterByDelivery,
  type EnrichmentSearchResult,
} from "../api/supplier-enrichment.ts";

const context = {
  supplierName: "Exact Coffee",
  supplierHostname: "exact-coffee.example",
  deliveryRegion: "Ukraine",
  sourceType: "official" as const,
};

function result(content: string, overrides: Partial<EnrichmentSearchResult> = {}): EnrichmentSearchResult {
  return {
    title: "Exact Coffee wholesale",
    url: "https://exact-coffee.example/catalog/beans",
    content,
    score: 0.9,
    ...overrides,
  };
}

test("official evidence explicitly connecting shipping and region confirms delivery", () => {
  const enriched = extractVerifiedEnrichment([result("Whole bean coffee. We deliver throughout Ukraine.")], context);
  assert.equal(enriched.delivery.status, "confirmed");
  assert.match(enriched.delivery.evidence ?? "", /deliver throughout Ukraine/i);
  assert.equal(enriched.delivery.sourceType, "official");
});

test("Ukrainian nationwide delivery phrases confirm delivery", () => {
  const ukrainianContext = { ...context, deliveryRegion: "Україна" };
  for (const phrase of [
    "Доставка в точки видачі Розетка по всій території України.",
    "Компанія забезпечує доставку по Україні через Нову Пошту.",
    "Доставляємо у всі регіони України.",
  ]) {
    assert.equal(extractVerifiedEnrichment([result(`Кава в зернах. ${phrase}`)], ukrainianContext).delivery.status, "confirmed");
  }
});

test("a country mention without delivery context does not confirm delivery", () => {
  assert.equal(extractVerifiedEnrichment([result("Whole bean coffee roasted in Ukraine.")], context).delivery.status, "not_confirmed");
});

test("same-domain office-paper delivery cannot confirm coffee delivery", () => {
  const enriched = extractVerifiedEnrichment([result(
    "Офісний папір А4. Доставляємо по всій Україні.",
    { title: "Папір офісний А4", url: "https://exact-coffee.example/catalog/office-paper" },
  )], context);
  assert.equal(enriched.product, null);
  assert.equal(enriched.delivery.status, "not_confirmed");
});

test("a clearly catalogue-wide shipping policy can confirm delivery", () => {
  const enriched = extractVerifiedEnrichment([result(
    "Shipping to Ukraine applies to all products and orders in our catalogue.",
    { title: "Shipping policy", url: "https://exact-coffee.example/shipping" },
  )], context);
  assert.equal(enriched.product, null);
  assert.equal(enriched.delivery.status, "confirmed");
});

test("supplier location does not imply delivery and delivery region does not imply location", () => {
  const located = extractVerifiedEnrichment([result("Whole bean coffee. Legal address: Warsaw, Poland.")], context);
  assert.equal(located.supplierLocation, "Warsaw, Poland");
  assert.equal(located.delivery.status, "not_confirmed");
  const delivering = extractVerifiedEnrichment([result("Whole bean coffee. Shipping to Ukraine.")], context);
  assert.equal(delivering.delivery.status, "confirmed");
  assert.equal(delivering.supplierLocation, null);
});

test("TLD and site language imply neither supplier location nor delivery", () => {
  const enriched = extractVerifiedEnrichment([result("Українська версія. Whole bean coffee.", { url: "https://exact-coffee.example.ua/coffee" })], {
    ...context, supplierHostname: "exact-coffee.example.ua",
  });
  assert.equal(enriched.supplierLocation, null);
  assert.equal(enriched.delivery.status, "not_confirmed");
});

test("explicit negative delivery is unavailable and conflicting evidence is unconfirmed", () => {
  const negative = extractVerifiedEnrichment([result("Whole bean coffee. We do not ship to Ukraine.")], context);
  assert.equal(negative.delivery.status, "not_available");
  const positive = extractVerifiedEnrichment([result("Whole bean coffee. We ship to Ukraine.")], context);
  assert.equal(mergeEnrichment(positive, negative).delivery.status, "not_confirmed");
  assert.equal(mergeEnrichment(positive, negative).delivery.evidence, null);
});

test("external supplier-specific evidence confirms delivery while generic lists do not", () => {
  const externalContext = { ...context, sourceType: "external" as const };
  const specific = result("Exact Coffee (exact-coffee.example) supplies whole bean coffee and ships to Ukraine.", {
    url: "https://trusted-profile.example/exact-coffee",
  });
  assert.equal(extractVerifiedEnrichment([specific], externalContext).delivery.status, "confirmed");
  const generic = result("Top 10 coffee suppliers in Ukraine. Shipping and wholesale comparison.", {
    title: "Top 10 coffee suppliers", url: "https://media.example/top-suppliers",
  });
  assert.equal(extractVerifiedEnrichment([generic], externalContext).delivery.status, "not_confirmed");
});

test("MOQ and concrete price require explicit evidence on a product-relevant result", () => {
  const enriched = extractVerifiedEnrichment([result("Whole bean coffee. MOQ: 20 kg. Wholesale price 618 ₴/кг.")], context);
  assert.equal(enriched.product, "Кава в зернах");
  assert.equal(enriched.moq, "20 кг");
  assert.equal(enriched.price, "618 ₴/кг");
});

test("identity-bound product-relevant discovery evidence contributes MOQ and price", async () => {
  const discovery = result(
    "Кава в зернах для бізнесу. Мінімальне замовлення 12 кг. Оптова ціна 620 грн/кг.",
    { title: "Exact Coffee — кава оптом", url: "https://exact-coffee.example/catalog/coffee" },
  );
  let calls = 0;
  const enriched = await enrichSupplier(
    { title: "Exact Coffee", url: discovery.url, domain: "exact-coffee.example", evidenceSources: [discovery] },
    "Кава в зернах", "Ukraine", async () => { calls += 1; return []; },
  );
  assert.equal(calls, 2);
  assert.equal(enriched.moq, "12 кг");
  assert.equal(enriched.price, "620 грн/кг");
});

test("minimum order value is not extracted as product price", () => {
  const enriched = extractVerifiedEnrichment([result(
    "Кава в зернах оптом. Мінімальна вартість замовлення 500 грн.",
    { title: "Royal Life — кава для бізнесу", url: "https://royal-life.ua/coffee" },
  )], { ...context, supplierName: "Royal Life", supplierHostname: "royal-life.ua" });
  assert.equal(enriched.product, "Кава в зернах");
  assert.equal(enriched.price, null);
});

test("package size is not MOQ and vague pricing is not a price", () => {
  const enriched = extractVerifiedEnrichment([result("Whole bean coffee in a 1 kg package. Low competitive prices.")], context);
  assert.equal(enriched.moq, null);
  assert.equal(enriched.price, null);
});

test("MOQ and price from a result without the requested product remain null", () => {
  const enriched = extractVerifiedEnrichment([result("Tea. MOQ: 20 kg. Wholesale price 100 UAH/kg.")], context);
  assert.equal(enriched.product, null);
  assert.equal(enriched.moq, null);
  assert.equal(enriched.price, null);
});

test("location requires an explicit address and rejects navigation garbage", () => {
  assert.equal(extractVerifiedEnrichment([result("Whole bean coffee. Headquarters: Berlin, Germany.")], context).supplierLocation, "Berlin, Germany");
  assert.equal(extractVerifiedEnrichment([result("Whole bean coffee. Контакти: ів - Карта сайту Контакти м")], context).supplierLocation, null);
});

test("official unknown delivery triggers one external search which can confirm it", async () => {
  const calls: Array<{ query: string; domains?: string[] }> = [];
  const enriched = await enrichSupplier({ title: "Exact Coffee", url: "https://exact-coffee.example" }, "whole bean coffee", "Ukraine", async (query, options) => {
    calls.push({ query, domains: options.includeDomains });
    if (calls.length === 1) return [result("Whole bean coffee wholesale catalog.")];
    return [result("Exact Coffee exact-coffee.example ships whole bean coffee to Ukraine.", { url: "https://profile.example/exact" })];
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].domains, ["exact-coffee.example"]);
  assert.equal(calls[1].domains, undefined);
  assert.match(calls[1].query, /Exact Coffee.*exact-coffee\.example.*Ukraine/i);
  assert.equal(enriched.delivery.status, "confirmed");
});

test("confirmed official delivery avoids an external request", async () => {
  let calls = 0;
  const enriched = await enrichSupplier({ title: "Exact Coffee", url: "https://exact-coffee.example" }, "coffee beans", "Ukraine", async () => {
    calls += 1;
    return [result("Coffee beans. We deliver throughout Ukraine.")];
  });
  assert.equal(calls, 1);
  assert.equal(enriched.delivery.status, "confirmed");
});

test("official and external request failures leave a safe unconfirmed result", async () => {
  let calls = 0;
  const enriched = await enrichSupplier({ title: "Exact Coffee", url: "https://exact-coffee.example" }, "coffee beans", "Ukraine", async () => {
    calls += 1;
    throw new Error("network unavailable");
  });
  assert.equal(calls, 2);
  assert.deepEqual(enriched, {
    product: null, moq: null, price: null, supplierLocation: null,
    delivery: { region: "Ukraine", status: "not_confirmed", evidence: null, sourceUrl: null, sourceType: null },
  });
});

test("only confirmed delivery passes the final filter, regardless of supplier MOQ or price", () => {
  const delivery = (status: "confirmed" | "not_confirmed" | "not_available") => ({
    region: "Ukraine", status, evidence: null, sourceUrl: null, sourceType: null,
  });
  const ranked = rankAndFilterByDelivery([
    { name: "unknown", score: 0.9, delivery: delivery("not_confirmed") },
    { name: "unavailable", score: 1, delivery: delivery("not_available") },
    { name: "confirmed", score: 0.5, moq: "50 кг", price: "900 ₴/кг", delivery: delivery("confirmed") },
  ]);
  assert.deepEqual(ranked.map(item => item.name), ["confirmed"]);
  assert.equal(ranked[0].moq, "50 кг", "supplier MOQ above the user's 20 кг maximum is not a hard filter");
  assert.equal(ranked[0].price, "900 ₴/кг", "supplier price is not a hard filter");
});

test("supplier-specific marketplace evidence can provide product, delivery, MOQ, and price", async () => {
  const marketplace = result(
    "Продавець: Gemini | Кава в зернах гуртом. MOQ: 50 кг. Оптова ціна 900 грн/кг. Доставка в Україну.",
    { title: "Gemini marketplace listing", url: "https://prom.ua/p456.html" },
  );
  let calls = 0;
  const enriched = await enrichSupplier(
    { title: "Gemini", url: "https://gemini.ua", domain: "gemini.ua", evidenceSources: [marketplace] },
    "Кава в зернах", "Україна", async () => { calls += 1; return []; }, undefined, "до 20 кг",
  );
  assert.equal(calls, 1, "confirmed discovered evidence avoids an unnecessary external lookup");
  assert.equal(enriched.delivery.status, "confirmed");
  assert.equal(enriched.delivery.sourceType, "marketplace");
  assert.equal(enriched.delivery.confirmationMethod, "marketplace_explicit_delivery");
  assert.equal(enriched.moq, "50 кг");
  assert.equal(enriched.price, "900 грн/кг");
  assert.equal(enriched.supplierLocation, null);
});

test("supplier-specific marketplace evidence accepts unlabeled price and wholesale MOQ", () => {
  const marketplaceContext = { supplierName: "Лідер Кава Україна", supplierHostname: "", deliveryRegion: "Україна", sourceType: "marketplace" as const };
  const enriched = extractVerifiedEnrichment([result(
    "Продавець: Лідер Кава Україна | Кава в зернах для бізнесу, опт від 1 кг, 753 ₴/кг. Доставка по Україні.",
    { title: "Лідер Кава Україна", url: "https://rozetka.com.ua/ua/coffee-123/p1" },
  )], marketplaceContext);
  assert.equal(enriched.product, "Кава в зернах");
  assert.equal(enriched.moq, "від 1 кг");
  assert.equal(enriched.price, "753 ₴/кг");
  assert.equal(enriched.delivery.status, "confirmed");
});

test("generic or mismatched marketplace prices are not supplier evidence", () => {
  const marketplaceContext = { supplierName: "Лідер Кава Україна", supplierHostname: "", deliveryRegion: "Україна", sourceType: "marketplace" as const };
  const generic = result("Категорія кави в зернах. Середня ціна 670 грн. Marketplace працює в Україні.", {
    title: "Кава — каталог", url: "https://rozetka.com.ua/ua/coffee/c1",
  });
  const otherSeller = result("Продавець: Other Tea | Чай Assam 670 грн. Доставка по Україні.", {
    title: "Other Tea", url: "https://rozetka.com.ua/ua/tea/p2",
  });
  const enriched = extractVerifiedEnrichment([generic, otherSeller], marketplaceContext);
  assert.equal(enriched.price, null);
  assert.equal(enriched.product, null);
  assert.equal(enriched.delivery.status, "not_confirmed");
});

test("a concrete marketplace listing can confirm nationwide delivery network availability", () => {
  const marketplaceContext = { supplierName: "Company A", supplierHostname: "", deliveryRegion: "Україна", sourceType: "marketplace" as const };
  const listing = result(
    "Продавець: Company A | Кава в зернах оптом. Доступна для замовлення з доставкою Розетка по всій території України.",
    { title: "Company A coffee", url: "https://rozetka.com.ua/ua/company-a-coffee/p3" },
  );
  const enriched = extractVerifiedEnrichment([listing], marketplaceContext);
  assert.equal(enriched.delivery.status, "confirmed");
  assert.equal(enriched.delivery.sourceType, "marketplace");
  assert.equal(enriched.delivery.confirmationMethod, "marketplace_delivery_network");
});

test("marketplace country presence without listing delivery remains unconfirmed", () => {
  const marketplaceContext = { supplierName: "Company A", supplierHostname: "", deliveryRegion: "Україна", sourceType: "marketplace" as const };
  const listing = result("Продавець: Company A | Кава в зернах оптом. Rozetka працює в Україні.", {
    title: "Company A coffee", url: "https://rozetka.com.ua/ua/company-a-coffee/p3",
  });
  assert.equal(extractVerifiedEnrichment([listing], marketplaceContext).delivery.status, "not_confirmed");
});
