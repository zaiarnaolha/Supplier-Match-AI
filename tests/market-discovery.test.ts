import assert from "node:assert/strict";
import test from "node:test";
import { buildAdditionalMarketAwareDiscoveryQuery, buildComplementaryMarketAwareDiscoveryQuery, buildMarketAwareDiscoveryQuery } from "../api/market-discovery.ts";

test("discovery uses delivery-market language without constraining supplier location", () => {
  const query = buildMarketAwareDiscoveryQuery("Кава в зернах", "Україна");
  assert.match(query, /оптом гуртом постачальник/);
  assert.match(query, /deliver to Україна/);
  assert.match(query, /supplier location may be any country/);
});

test("complementary discovery remains product-specific and targets missed supplier page types", () => {
  const query = buildComplementaryMarketAwareDiscoveryQuery("Кава в зернах", "Україна");
  assert.match(query, /^Кава в зернах /);
  assert.match(query, /manufacturers, producers, distributors, HoReCa suppliers, wholesale catalogues, and B2B product pages/);
  assert.match(query, /supplier location may be any country/);
  assert.match(query, /evidence sources only/);
});

test("additional discovery preserves market language but changes commercial intent", () => {
  const primary = buildMarketAwareDiscoveryQuery("Кава в зернах", "Україна");
  const additional = buildAdditionalMarketAwareDiscoveryQuery("Кава в зернах", "Україна");
  assert.notEqual(additional, primary);
  assert.match(additional, /Use Ukrainian market terminology: оптом гуртом постачальник/);
  assert.match(additional, /trade accounts, bulk purchasing, and minimum-order offers/);
  assert.match(additional, /supplier location may be any country/);
});
