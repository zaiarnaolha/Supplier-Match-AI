import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichSupplier,
  extractVerifiedEnrichment,
  mergeEnrichment,
  priceCandidatesOf,
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

test("external evidence accepts only URLs on an established canonical supplier domain", () => {
  const externalResult = (url: string) => result("Whole bean coffee. Price 600 грн/кг.", {
    title: "Whole bean coffee",
    url,
  });
  for (const [supplierHostname, evidenceUrl] of [
    ["supplier.com", "https://supplier.com/coffee"],
    ["supplier.com", "https://www.supplier.com/coffee"],
    ["supplier.com", "https://shop.supplier.com/coffee"],
    ["supplier.com.ua", "https://supplier.com.ua/coffee"],
    ["supplier.com.ua", "https://www.supplier.com.ua/coffee"],
    ["supplier.com.ua", "https://shop.supplier.com.ua/coffee"],
  ]) {
    const enriched = extractVerifiedEnrichment([externalResult(evidenceUrl)], {
      supplierName: "Established Supplier",
      supplierHostname,
      deliveryRegion: "Ukraine",
      sourceType: "external",
    });
    assert.equal(enriched.price, "600 грн/кг", `${evidenceUrl} should belong to ${supplierHostname}`);
  }

  for (const evidenceUrl of ["https://other-supplier.com/coffee", "https://supplier-shop.com/coffee"]) {
    const enriched = extractVerifiedEnrichment([externalResult(evidenceUrl)], {
      supplierName: "Established Supplier",
      supplierHostname: "supplier.com",
      deliveryRegion: "Ukraine",
      sourceType: "external",
    });
    assert.equal(enriched.product, null, `${evidenceUrl} must not bind to supplier.com`);
    assert.equal(enriched.price, null, `${evidenceUrl} must not contribute a price`);
  }
});

test("external URL ownership requires an established domain while textual supplier-name matching remains valid", () => {
  const externalContext = {
    supplierName: "Named Supplier",
    supplierHostname: "",
    deliveryRegion: "Ukraine",
    sourceType: "external" as const,
  };
  const urlOnly = result("Whole bean coffee. Price 600 грн/кг.", {
    title: "Whole bean coffee",
    url: "https://supplier.com/coffee",
  });
  assert.equal(extractVerifiedEnrichment([urlOnly], externalContext).price, null);

  const nameBound = result("Named Supplier sells whole bean coffee. Price 600 грн/кг.", {
    title: "Whole bean coffee",
    url: "https://trusted-profile.example/coffee",
  });
  assert.equal(extractVerifiedEnrichment([nameBound], externalContext).price, "600 грн/кг");
});

test("MOQ and concrete price require explicit evidence on a product-relevant result", () => {
  const enriched = extractVerifiedEnrichment([result("Whole bean coffee. MOQ: 20 kg. Wholesale price 618 ₴/кг.")], context);
  assert.equal(enriched.product, "Кава в зернах");
  assert.equal(enriched.moq, "20 кг");
  assert.equal(enriched.price, "618 ₴/кг");
});

test("aggregates comparable structured prices across evidence and keeps public shape unchanged", () => {
  const enriched = extractVerifiedEnrichment([
    result("Whole bean coffee. Wholesale price 704 грн/кг."),
    result("Whole bean coffee. Wholesale price 616 грн/кг."),
    result("Whole bean coffee. Wholesale price 660 грн/кг."),
  ], context);
  assert.equal(enriched.price, "від 616 грн/кг");
  assert.equal(priceCandidatesOf(enriched).length, 3);
  assert.deepEqual(Object.keys(enriched).sort(), ["delivery", "moq", "price", "product", "supplierLocation"]);
});

test("deduplicates repeated literal-from facts despite compatible scope enrichment", () => {
  const enriched = extractVerifiedEnrichment([
    result("Whole bean coffee. Price від 535 грн/кг."),
    result("Whole bean coffee. Wholesale price від 535 грн/кг."),
  ], context);
  assert.equal(enriched.price, "від 535 грн/кг");
  assert.equal(priceCandidatesOf(enriched).length, 2, "provenance observations remain available internally");
});

test("does not arbitrarily select among incompatible semantic price groups", () => {
  const enriched = extractVerifiedEnrichment([
    result("Whole bean coffee. Wholesale price 600 грн/кг."),
    result("Whole bean coffee. Wholesale price 868 грн/шт."),
  ], context);
  assert.equal(enriched.price, null, "one candidate in each basis gives no principled group preference");
});

test("merge retains structured observations and recomputes rather than discarding disagreement", () => {
  const first = extractVerifiedEnrichment([result("Whole bean coffee. Wholesale price 660 грн/кг.")], context);
  const second = extractVerifiedEnrichment([result("Whole bean coffee. Wholesale price 616 грн/кг.")], context);
  const merged = mergeEnrichment(first, second);
  assert.equal(merged.price, "від 616 грн/кг");
  assert.equal(priceCandidatesOf(merged).length, 2);

  const incompatible = extractVerifiedEnrichment([result("Whole bean coffee. Wholesale price 20 USD/kg.")], context);
  assert.equal(mergeEnrichment(first, incompatible).price, null);
});

test("structured candidates survive production-style object copies and a primary merge", () => {
  const verified = extractVerifiedEnrichment([result("Whole bean coffee. Wholesale price 600 грн.")], context);
  const copied = { ...verified };
  assert.equal(priceCandidatesOf(copied).length, 1, "object spread must retain private candidate metadata");
  assert.equal(JSON.stringify(copied).includes("structuredPrices"), false, "internal metadata must not enter public JSON");

  const primary = {
    product: "Кава в зернах", moq: null, price: null, supplierLocation: null,
    delivery: { region: "Ukraine", status: "not_confirmed" as const, evidence: null, sourceUrl: null, sourceType: null },
  };
  const merged = mergeEnrichment(primary, copied);
  assert.equal(merged.price, "600 грн");
  assert.equal(priceCandidatesOf(merged).length, 1);
  assert.deepEqual(Object.keys(merged).sort(), ["delivery", "moq", "price", "product", "supplierLocation"]);
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

test("zero product price remains missing without affecting confirmed supplier delivery", () => {
  const enriched = extractVerifiedEnrichment([result(
    "Whole bean coffee. Price 0,00 грн. We deliver throughout Ukraine.",
  )], context);
  assert.equal(enriched.product, "Кава в зернах");
  assert.equal(enriched.price, null);
  assert.equal(enriched.delivery.status, "confirmed");
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

test("confirmed official delivery with complete informational facts avoids fact completion", async () => {
  const calls: string[] = [];
  const enriched = await enrichSupplier({ title: "Exact Coffee", url: "https://exact-coffee.example" }, "coffee beans", "Ukraine", async query => {
    calls.push(query);
    return [result("Coffee beans. MOQ 20 kg. Wholesale price 618 ₴/кг. We deliver throughout Ukraine.")];
  });
  assert.equal(calls.length, 1);
  assert.equal(enriched.delivery.status, "confirmed");
  assert.equal(enriched.moq, "20 кг");
  assert.equal(enriched.price, "618 ₴/кг");
});

test("confirmed delivery with missing MOQ performs one bounded supplier-specific fact completion", async () => {
  const calls: Array<{ query: string; maxResults: number }> = [];
  const enriched = await enrichSupplier({ title: "Exact Coffee", url: "https://exact-coffee.example" }, "coffee beans", "Ukraine", async (query, options) => {
    calls.push({ query, maxResults: options.maxResults });
    if (calls.length === 1) return [result("Coffee beans. Wholesale price 618 ₴/кг. We deliver throughout Ukraine.")];
    return [result("Exact Coffee supplies coffee beans. Minimum order 30 kg.", { url: "https://profile.example/exact" })];
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].maxResults, 5);
  assert.match(calls[1].query, /^"Exact Coffee" "exact-coffee\.example" coffee beans MOQ minimum order wholesale order$/);
  assert.doesNotMatch(calls[1].query, /product price/);
  assert.equal(enriched.moq, "30 кг");
  assert.equal(enriched.price, "618 ₴/кг");
  assert.equal(enriched.delivery.status, "confirmed");
});

test("confirmed delivery with missing price performs one targeted fact completion", async () => {
  const calls: string[] = [];
  const enriched = await enrichSupplier({ title: "Exact Coffee", url: "https://exact-coffee.example" }, "coffee beans", "Ukraine", async query => {
    calls.push(query);
    if (calls.length === 1) return [result("Coffee beans. MOQ 20 kg. We deliver throughout Ukraine.")];
    return [result("Exact Coffee coffee beans. Price 620 грн/кг.", { url: "https://profile.example/exact" })];
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /price wholesale price product price$/);
  assert.doesNotMatch(calls[1], /MOQ minimum order/);
  assert.equal(enriched.moq, "20 кг");
  assert.equal(enriched.price, "620 грн/кг");
  assert.equal(enriched.delivery.status, "confirmed");
});

test("fact completion accepts product evidence from the established domain's subdomain", async () => {
  const calls: string[] = [];
  let externalEvaluation: Record<string, unknown> | undefined;
  const enriched = await enrichSupplier(
    { title: "Established Supplier", url: "https://supplier.com", domain: "supplier.com" },
    "coffee beans",
    "Ukraine",
    async query => {
      calls.push(query);
      if (calls.length === 1) {
        return [result("Coffee beans. MOQ 20 kg. We deliver throughout Ukraine.", {
          title: "Coffee beans",
          url: "https://supplier.com/coffee",
        })];
      }
      return [result("Coffee beans. Price 620 грн/кг.", {
        title: "Coffee beans",
        url: "https://shop.supplier.com/coffee",
      })];
    },
    (stage, payload) => {
      if (stage === "external") externalEvaluation = (payload.evaluations as Record<string, unknown>[])[0];
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(externalEvaluation?.identityMatchedBy, "hostname");
  assert.equal(externalEvaluation?.supplierIdentityMatched, true);
  assert.equal(enriched.moq, "20 кг");
  assert.equal(enriched.price, "620 грн/кг");
  assert.equal(enriched.delivery.status, "confirmed");
});

test("not-available delivery skips fact completion even when informational facts are missing", async () => {
  let calls = 0;
  const enriched = await enrichSupplier({ title: "Exact Coffee", url: "https://exact-coffee.example" }, "coffee beans", "Ukraine", async () => {
    calls += 1;
    return [result("Coffee beans. We do not ship to Ukraine.")];
  });
  assert.equal(calls, 1);
  assert.equal(enriched.delivery.status, "not_available");
  assert.equal(enriched.moq, null);
  assert.equal(enriched.price, null);
});

test("fact completion retains current ownership, product, and conservative extraction gates", async () => {
  const unsafeResults = [
    result("Other Coffee coffee beans. MOQ 5 kg. Price 500 грн/кг.", { title: "Other Coffee", url: "https://other.example/coffee" }),
    result("Top 10 suppliers. Exact Coffee coffee beans. MOQ 6 kg. Price 510 грн/кг.", { title: "Top 10 coffee suppliers", url: "https://directory.example/top" }),
    result("Exact Coffee tea. MOQ 7 kg. Price 520 грн/кг.", { title: "Exact Coffee tea", url: "https://profile.example/tea" }),
    result("Exact Coffee coffee beans in a 20 kg package. Minimum order value 530 грн. Delivery fee 40 грн.", { url: "https://profile.example/exact" }),
  ];
  const calls: string[] = [];
  const enriched = await enrichSupplier({ title: "Exact Coffee", url: "https://exact-coffee.example" }, "coffee beans", "Ukraine", async query => {
    calls.push(query);
    return calls.length === 1 ? [result("Coffee beans. We deliver throughout Ukraine.")] : unsafeResults;
  });
  assert.equal(calls.length, 2, "fact completion is bounded to one external search");
  assert.match(calls[1], /MOQ minimum order wholesale order price wholesale price product price$/);
  assert.equal(enriched.delivery.status, "confirmed");
  assert.equal(enriched.moq, null);
  assert.equal(enriched.price, null);
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
