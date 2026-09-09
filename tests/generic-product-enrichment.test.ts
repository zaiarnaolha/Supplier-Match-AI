import assert from "node:assert/strict";
import test from "node:test";
import {
  extractVerifiedEnrichment,
  type EnrichmentSearchResult,
} from "../api/supplier-enrichment.ts";

function evidence(
  title: string,
  content: string,
  url = "https://paper-pro.example/catalog/item",
): EnrichmentSearchResult {
  return { title, content, url, score: 0.9 };
}

const paperContext = {
  supplierName: "Paper Pro",
  supplierHostname: "paper-pro.example",
  deliveryRegion: "Україна",
  sourceType: "official" as const,
  requestedProduct: "офісний папір А4",
};

test("requested generic product can confirm product and delivery from supplier-specific evidence", () => {
  const enriched = extractVerifiedEnrichment([
    evidence(
      "Офісний папір А4 оптом — Paper Pro",
      "Офісний папір А4 для бізнесу. Доставляємо по Україні.",
    ),
  ], paperContext);

  assert.equal(enriched.product, "офісний папір А4");
  assert.equal(enriched.delivery.status, "confirmed");
});

test("delivery for another product cannot confirm requested generic product", () => {
  const enriched = extractVerifiedEnrichment([
    evidence(
      "Паперові стаканчики оптом — Paper Pro",
      "Паперові стаканчики для бізнесу. Доставляємо по Україні.",
      "https://paper-pro.example/catalog/cups",
    ),
  ], paperContext);

  assert.equal(enriched.product, null);
  assert.equal(enriched.delivery.status, "not_confirmed");
});

test("generic product can be verified from commercial content, not only title", () => {
  const cupsContext = { ...paperContext, requestedProduct: "паперові стаканчики" };
  const enriched = extractVerifiedEnrichment([
    evidence(
      "Каталог HoReCa — Paper Pro",
      "Паперові стаканчики оптом для бізнесу. Доставляємо по Україні.",
      "https://paper-pro.example/catalog/horeca",
    ),
  ], cupsContext);

  assert.equal(enriched.product, "паперові стаканчики");
  assert.equal(enriched.delivery.status, "confirmed");
});

test("coffee request is not confirmed by a different product page even when delivery is confirmed", () => {
  const coffeeContext = {
    supplierName: "Exact Coffee",
    supplierHostname: "exact-coffee.example",
    deliveryRegion: "Україна",
    sourceType: "official" as const,
    requestedProduct: "Кава в зернах",
  };

  const enriched = extractVerifiedEnrichment([
    evidence(
      "Офісний папір А4 — Exact Coffee",
      "Офісний папір А4 для бізнесу. Доставляємо по Україні.",
      "https://exact-coffee.example/catalog/office-paper",
    ),
  ], coffeeContext);

  assert.equal(enriched.product, null);
  assert.equal(enriched.delivery.status, "not_confirmed");
});
