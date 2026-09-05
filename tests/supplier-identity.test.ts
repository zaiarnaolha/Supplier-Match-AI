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
  });
});

test("Rozetka listing identity is the named seller and never the marketplace domain", () => {
  assert.deepEqual(identifySupplier(
    "Кава в зернах | Rozetka",
    "Продавець: Company A | Кава для бізнесу оптом.",
    "https://rozetka.com.ua/ua/company-a-coffee/p3",
  ), { name: "Company A", domain: null, officialUrl: null, sourceType: "marketplace" });
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
  });
});

test("generic supplier words and generic page headings are not supplier display names", () => {
  assert.equal(identifySupplier("виробник", "Кава в зернах оптом.", "https://supplier.example/coffee"), null);
  const identity = identifySupplier(
    "Зелена кава в зернах із Бразилії",
    "Royal Life — постачальник кави для бізнесу.",
    "https://royal-life.ua/green-coffee",
  );
  assert.equal(identity?.name, "Royal Life");
});

test("recovers official brand names from product and geography pages", () => {
  assert.equal(identifySupplier(
    "Кава для ресторанів Львова",
    "!FEST Coffee Mission. Обсмажуємо каву для HoReCa.",
    "https://festcoffeemission.com/lviv/coffee",
  )?.name, "!FEST Coffee Mission");
  assert.equal(identifySupplier(
    "Кава оптом від українського виробника Royal Life",
    "Royal Life постачає каву для бізнесу.",
    "https://royal-life.ua/kava-optom",
  )?.name, "Royal Life");
});

test("an ambiguous source with a labeled concrete company is preserved", () => {
  assert.equal(identifySupplier(
    "Продукты питания / напитки в городе Ужгород",
    "Компанія: TREVI — постачальник кави для HoReCa.",
    "https://all.biz/coffee-listing",
  )?.name, "TREVI");
});
