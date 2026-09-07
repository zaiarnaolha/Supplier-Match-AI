import assert from "node:assert/strict";
import test from "node:test";
import { buildSupplierSearchRequest, deriveSupplierSearchCriteria } from "../shared/supplier-search-criteria.ts";

const controlQuery = "Шукаю постачальника кави в зернах в Україні для невеликої кав'ярні, MOQ до 20 кг";

test("MOQ wording is ignored while product and delivery remain structured", () => {
  assert.deepEqual(deriveSupplierSearchCriteria(controlQuery), {
    product: "Кава в зернах",
    deliveryRegion: "Україна",
  });
});

test("frontend request carries normalized criteria and selected region labels", () => {
  assert.deepEqual(buildSupplierSearchRequest(`  ${controlQuery}  `), {
    query: controlQuery,
    deliveryRegion: "Україна",
    criteria: {
      product: "Кава в зернах",
      deliveryRegion: "Україна",
    },
  });
  assert.equal(buildSupplierSearchRequest("Кава в зернах", "ukraine").deliveryRegion, "Україна");
});
