import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketAwareDiscoveryQuery } from "../api/market-discovery.ts";

test("discovery uses delivery-market language without constraining supplier location", () => {
  const query = buildMarketAwareDiscoveryQuery("Кава в зернах", "Україна");
  assert.match(query, /оптом гуртом постачальник/);
  assert.match(query, /deliver to Україна/);
  assert.match(query, /supplier location may be any country/);
});
