import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEnrichmentQuery,
  extractDelivery,
  extractEnrichment,
  extractSupplierLocation,
} from "../api/supplier-enrichment.ts";
import { supplierEnrichmentSnippets } from "./fixtures/supplier-enrichment-snippets.ts";

test("builds a targeted query constrained to the official hostname", () => {
  const query = buildEnrichmentQuery("coffee.example", "whole bean coffee", "Poland");
  assert.match(query, /^site:coffee\.example /);
  assert.match(query, /MOQ minimum order/);
  assert.match(query, /exact wholesale price/);
  assert.match(query, /delivery shipping Poland/);
  assert.match(query, /company location address/);
});

test("extracts only concrete enrichment values", () => {
  assert.deepEqual(extractEnrichment(supplierEnrichmentSnippets.confirmed, "Poland"), {
    product: "Кава в зернах",
    moq: "20 кг",
    price: "$10/kg",
    supplierLocation: "Lviv, Ukraine",
    delivery: { region: "Poland", status: "confirmed", evidence: "We deliver to Poland." },
  });
});

test("distinguishes unavailable and unconfirmed delivery", () => {
  assert.equal(extractDelivery(supplierEnrichmentSnippets.unavailable, "Poland").status, "not_available");
  assert.deepEqual(extractDelivery(supplierEnrichmentSnippets.geographyOnly, "Poland"), {
    region: "Poland", status: "not_confirmed", evidence: null,
  });
});

test("does not infer supplier location from delivery, origin, or TLD", () => {
  assert.equal(extractSupplierLocation(supplierEnrichmentSnippets.geographyOnly), null);
  assert.equal(extractSupplierLocation([{
    title: "Delivery to Ukraine", content: "We ship throughout Ukraine.", url: "https://supplier.com.ua",
  }]), null);
});

test("returns null for contradictory concrete values", () => {
  const result = extractEnrichment([
    { title: "Whole bean coffee", content: "MOQ 10 kg. Wholesale price $8/kg.", url: "https://supplier.example/a" },
    { title: "Whole bean coffee", content: "MOQ 20 kg. Wholesale price $9/kg.", url: "https://supplier.example/b" },
  ], "Poland");
  assert.equal(result.moq, null);
  assert.equal(result.price, null);
});
