import assert from "node:assert/strict";
import test from "node:test";
import { qualifySupplierCandidate } from "../api/supplier-qualification.ts";
import { supplierQualificationSnippets } from "./fixtures/supplier-qualification-snippets.ts";

function qualify(fixture: { title: string; content: string; url: string }) {
  return qualifySupplierCandidate(fixture.title, fixture.content, fixture.url);
}

test("qualifies a concrete supplier", () => {
  const result = qualify(supplierQualificationSnippets.supplier);
  assert.equal(result.qualified, true);
  if (result.qualified) assert.equal(result.confidence, "high");
});

test("qualifies a manufacturer with explicit self-identification", () => {
  assert.equal(qualify(supplierQualificationSnippets.manufacturer).qualified, true);
});

test("qualifies a concrete wholesale store", () => {
  assert.equal(qualify(supplierQualificationSnippets.wholesaleStore).qualified, true);
});

test("rejects the real rating and top-list scenario", () => {
  assert.equal(qualify(supplierQualificationSnippets.ratingArticle).qualified, false);
});

test("rejects an informational or news article", () => {
  assert.equal(qualify(supplierQualificationSnippets.newsArticle).qualified, false);
});

test("rejects a how-to guide even when it mentions manufacturers", () => {
  assert.equal(qualify(supplierQualificationSnippets.howToChoose).qualified, false);
});

test("rejects an aggregating Prom.ua marketplace category", () => {
  assert.equal(qualify(supplierQualificationSnippets.promCategory).qualified, false);
});

test("rejects a product page without a concrete seller identity", () => {
  assert.equal(qualify(supplierQualificationSnippets.ambiguousProduct).qualified, false);
});

test("does not qualify from a buy word or product mention alone", () => {
  assert.equal(qualifySupplierCandidate(
    "Кава в зернах — купити онлайн",
    "Великий вибір товарів.",
    "https://example.com/catalog/coffee",
  ).qualified, false);
});

test("requires business identity and commercial activity for medium confidence", () => {
  const result = qualifySupplierCandidate(
    "Про компанію Example Coffee",
    "Каталог продукції та ціни для кав'ярень.",
    "https://example.com/catalog/coffee",
  );
  assert.equal(result.qualified, true);
  if (result.qualified) assert.equal(result.confidence, "medium");

  assert.equal(qualifySupplierCandidate(
    "Про компанію Example Coffee",
    "Історія нашої команди.",
    "https://example.com/about",
  ).qualified, false);
});

test("editorial evidence vetoes supplier words in article content", () => {
  assert.equal(qualifySupplierCandidate(
    "Топ-10 постачальників кави",
    "Огляд виробників та оптових магазинів.",
    "https://example.com/articles/top-suppliers",
  ).qualified, false);
});

test("rejects a retail-only marketplace seller without B2B evidence", () => {
  assert.equal(qualifySupplierCandidate(
    "Кава в зернах | продавець Retail Coffee",
    "Магазин Retail Coffee. В наявності. Додати у кошик.",
    "https://prom.ua/p123.html",
  ).qualified, false);
});

test("qualifies supplier-specific marketplace evidence with an explicit wholesale signal", () => {
  assert.equal(qualifySupplierCandidate(
    "Кава в зернах | продавець Gemini",
    "Компанія Gemini. Кава гуртом для HoReCa. MOQ: 30 кг.",
    "https://prom.ua/p456.html",
  ).qualified, true);
});

test("accepts RoyalLife-style wholesale evidence for businesses", () => {
  const result = qualifySupplierCandidate(
    "Кава оптом RoyalLife",
    "Кава в зернах оптом вигідно для бізнесів. Арабіка та робуста оптом.",
    "https://royal-life.ua/kava-optom",
  );
  assert.equal(result.qualified, true);
  if (result.qualified) assert.deepEqual(result.evidence.map(value => value.toLocaleLowerCase()), ["оптом", "для бізнесів"]);
});

test("still rejects a retail-only official product page", () => {
  assert.equal(qualifySupplierCandidate(
    "Кава в зернах — купити",
    "Ціна 670 грн. Додати у кошик. Швидке оформлення замовлення.",
    "https://retail.example/coffee",
  ).qualified, false);
});

test("qualifies a concrete marketplace seller with product-specific B2B evidence", () => {
  assert.equal(qualifySupplierCandidate(
    "Свіжообсмажена кава в зернах Premium | Продавець: Company A",
    "Кава для бізнесу, опт від 1 кг. Гуртова ціна 753 ₴/кг.",
    "https://rozetka.com.ua/ua/company-a-coffee/p3",
  ).qualified, true);
});

test("generic marketplace search or category evidence remains rejected", () => {
  assert.equal(qualifySupplierCandidate(
    "Кава оптом — каталог продавців",
    "100 пропозицій від різних продавців. Порівняти ціни.",
    "https://prom.ua/ua/coffee.html",
  ).qualified, false);
});
