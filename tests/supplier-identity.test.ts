import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSupplierDomain, classifySourceRole, companyIdentityKey, identifySupplier, supplierIdentityKey } from "../api/supplier-identity.ts";
import { asDiscoveryEvidence, resolveSupplierIdentities } from "../api/supplier-discovery.ts";

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

test("Instagram page titles cannot become official supplier identities", () => {
  assert.equal(identifySupplier(
    "TORBAFOOD (@torbafood) • Instagram photos and videos",
    "Кава в зернах оптом для HoReCa.",
    "https://www.instagram.com/reel/example/",
  ), null);
});

test("platform evidence needs an explicit seller or company identity", () => {
  const identity = identifySupplier(
    "Кава для HoReCa • Instagram",
    "Бренд: TORBAFOOD | Кава в зернах оптом.",
    "https://instagram.com/p/example/",
  );
  assert.equal(identity?.name, "TORBAFOOD");
  assert.equal(identity?.sourceType, "external");
  assert.equal(identity?.officialUrl, null);
});

test("Leader Coffee resolves from official domain-matched brand and B2B evidence", () => {
  const evidence = asDiscoveryEvidence([{
    title: "Кава в зернах оптом | Leader Coffee",
    content: "Leader Coffee пропонує оптові поставки кави для HoReCa.",
    url: "https://leadercoffee.com.ua/coffee/wholesale",
    score: 0.9,
  }], "primary");
  const resolved = resolveSupplierIdentities(evidence);
  assert.equal(resolved.suppliers.length, 1);
  assert.equal(resolved.suppliers[0].identity.name, "Leader Coffee");
  assert.equal(resolved.suppliers[0].identity.domain, "leadercoffee.com.ua");
});

test("numeric domain fallback is not a strong display identity without brand evidence", () => {
  assert.equal(identifySupplier(
    "Кава в зернах оптом",
    "Оптові поставки кави для HoReCa.",
    "https://808.com.ua/catalog/coffee",
  ), null);
  assert.equal(identifySupplier(
    "Кава в зернах оптом",
    "Компанія: 808 Coffee. Оптові поставки кави для HoReCa.",
    "https://808.com.ua/catalog/coffee",
  )?.name, "808 Coffee");
});

test("generic directory, category, classified, and Russian page titles do not become identities", () => {
  const pages = [
    ["Продукты питания / напитки в городе Ужгород", "Каталог товаров и услуг.", "https://abyhom.com/catalog/food"],
    ["Продам ЗЕРНО гречки", "Доска объявлений. Оптовая продажа.", "https://bboard.com.ua/obyavleniya/123"],
    ["APKUA", "Каталог компаній та товарів для агробізнесу.", "https://apkua.com/search/coffee"],
  ] as const;
  for (const [title, content, url] of pages) {
    assert.equal(classifySourceRole(title, content, url), "directory_classified");
    assert.equal(identifySupplier(title, content, url), null);
  }
});

test("directory evidence resolves an explicitly identified concrete company", () => {
  const evidence = asDiscoveryEvidence([{
    title: "Каталог постачальників кави",
    content: "Компанія: BUNO. BUNO — виробник кави в зернах оптом для HoReCa.",
    url: "https://europages.com.ua/buno-coffee",
    score: 0.8,
  }], "primary");
  const resolved = resolveSupplierIdentities(evidence);
  assert.equal(resolved.suppliers.length, 1);
  assert.equal(resolved.suppliers[0].identity.name, "BUNO");
  assert.equal(resolved.suppliers[0].identity.sourceType, "directory");
});

test("exact verified company identity dedupes two official domains", () => {
  const resolved = resolveSupplierIdentities(asDiscoveryEvidence([
    { title: "Leader Coffee | Опт", content: "Компанія: Leader Coffee. Кава в зернах оптом для HoReCa.", url: "https://leadercoffee.ua/b2b", score: 0.9 },
    { title: "Кава для бізнесу | Leader Coffee", content: "Компанія: Leader Coffee. Оптовий постачальник кави для HoReCa.", url: "https://leadercoffee.com.ua/wholesale", score: 0.8 },
  ], "primary"));
  assert.equal(resolved.suppliers.length, 1);
  assert.equal(resolved.suppliers[0].evidence.length, 2);
  assert.equal(resolved.resolutions[1].dedupeDecision, "merged_company");
  assert.equal(resolved.resolutions[0].companyIdentityKey, "company:leadercoffee");
});

test("similar but non-identical company names do not dedupe", () => {
  const first = identifySupplier("Leader Coffee", "Компанія: Leader Coffee. Кава оптом для HoReCa.", "https://leadercoffee.ua/b2b");
  const second = identifySupplier("Leader Coffee Group", "Компанія: Leader Coffee Group. Кава оптом для HoReCa.", "https://leader-coffee-group.example/b2b");
  assert.ok(first && second);
  assert.notEqual(companyIdentityKey(first), companyIdentityKey(second));
});
