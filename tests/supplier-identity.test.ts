import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSupplierDomain, identifySupplier, supplierIdentityKey } from "../api/supplier-identity.ts";

test("supplier subdomains share one canonical identity", () => {
  assert.equal(canonicalSupplierDomain("https://store.gemini.ua/catalog"), "gemini.ua");
  const site = identifySupplier("Gemini | Кава оптом", "Ми постачальник для HoReCa.", "https://gemini.ua/wholesale");
  const store = identifySupplier("Gemini | Кава в зернах", "Оптова ціна.", "https://store.gemini.ua/coffee");
  assert.ok(site && store);
  assert.equal(supplierIdentityKey(site), supplierIdentityKey(store));
});

test("Ukrainian regional public suffixes retain the registrable supplier label", () => {
  assert.equal(canonicalSupplierDomain("https://horecacoffee.cn.ua/catalog"), "horecacoffee.cn.ua");
  assert.equal(canonicalSupplierDomain("https://palitra.ck.ua/coffee"), "palitra.ck.ua");
  assert.notEqual(canonicalSupplierDomain("https://horecacoffee.cn.ua"), "cn.ua");
  assert.notEqual(canonicalSupplierDomain("https://palitra.ck.ua"), "ck.ua");
});

test("marketplace page identifies its concrete seller and retains the marketplace as source", () => {
  const identity = identifySupplier(
    "Кава в зернах | Prom.ua",
    "Продавець: Gemini | Оптова ціна 600 грн/кг. Офіційний сайт: https://store.gemini.ua/catalog",
    "https://prom.ua/p123-coffee.html",
  );
  assert.deepEqual(identity, {
    name: "Gemini",
    domain: "gemini.ua",
    officialUrl: "https://store.gemini.ua/catalog",
    sourceType: "marketplace",
    aliases: ["Gemini"],
    identitySource: "seller_label",
    confidence: "high",
  });
});

test("Rozetka listing identity is the named seller and never the marketplace domain", () => {
  assert.deepEqual(identifySupplier(
    "Кава в зернах | Rozetka",
    "Продавець: Company A | Кава для бізнесу оптом.",
    "https://rozetka.com.ua/ua/company-a-coffee/p3",
  ), { name: "Company A", domain: null, officialUrl: null, sourceType: "marketplace", aliases: ["Company A"], identitySource: "seller_label", confidence: "high" });
});

test("marketplace, directory, and article pages without a named seller are not suppliers", () => {
  assert.equal(identifySupplier("Кава оптом", "100 пропозицій від продавців", "https://prom.ua/coffee.html"), null);
  assert.equal(identifySupplier("Top suppliers", "A general guide.", "https://media.example/articles/top"), null);
  assert.equal(identifySupplier("Catalog", "Companies directory.", "https://europages.com/coffee"), null);
});

test("official KavaUA identity supersedes a TESORO product-page title", () => {
  assert.deepEqual(identifySupplier(
    "☕ Кава в зернах свіжого обсмаження TESORO",
    "KavaUA — кава для бізнесу та HoReCa. Кава в зернах оптом.",
    "https://kavaua.com.ua/product/tesoro",
  ), {
    name: "KavaUA",
    domain: "kavaua.com.ua",
    officialUrl: "https://kavaua.com.ua/product/tesoro",
    sourceType: "official",
    aliases: ["KavaUA", "kavaua"],
    identitySource: "official_domain",
    confidence: "medium",
  });
});

test("generic roles and product/category titles cannot become supplier identities", () => {
  for (const [title, domain] of [["виробник", "manufacturer"], ["постачальник", "supplier"], ["дистриб'ютор", "distributor"], ["seller", "seller"], ["supplier", "supplier"], ["manufacturer", "manufacturer"], ["Купити каву оптом", "catalog"], ["Кава — каталог", "category"]]) {
    assert.equal(identifySupplier(title, "Кава в зернах оптом.", `https://${domain}.example/coffee`), null);
  }
});

test("generic product page resolves through strong company metadata", () => {
  const identity = identifySupplier("Купити каву оптом", "Компанія: Royal Life. Кава в зернах для HoReCa.", "https://royal-life.ua/wholesale");
  assert.equal(identity?.name, "Royal Life");
  assert.equal(identity?.identitySource, "company_label");
});
