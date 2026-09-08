import assert from "node:assert/strict";
import test from "node:test";
import { buildSupplierSearchRequest, deriveSupplierSearchCriteria } from "../shared/supplier-search-criteria.ts";

const controlQuery = "Шукаю постачальника кави в зернах в Україні для невеликої кав'ярні, MOQ до 20 кг";

test("control scenario becomes structured user criteria without hardcoding the whole query", () => {
  assert.deepEqual(deriveSupplierSearchCriteria(controlQuery), {
    product: "Кава в зернах",
    deliveryRegion: "Україна",
    maxMoq: { value: 20, unit: "кг", displayValue: "до 20 кг" },
  });
});

test("frontend request carries normalized criteria and selected region labels", () => {
  assert.deepEqual(buildSupplierSearchRequest(`  ${controlQuery}  `), {
    query: controlQuery,
    deliveryRegion: "Україна",
    criteria: {
      product: "Кава в зернах",
      deliveryRegion: "Україна",
      maxMoq: { value: 20, unit: "кг", displayValue: "до 20 кг" },
    },
  });
  assert.equal(buildSupplierSearchRequest("Кава в зернах", "ukraine").deliveryRegion, "Україна");
});

test("generic products are separated from delivery region and optional criteria", () => {
  const cases = [
    ["Шукаю постачальника офісного паперу в Україні", "офісного паперу"],
    ["Потрібен постачальник паперових стаканчиків з доставкою в Україну", "паперових стаканчиків"],
    ["Знайти постачальника оливкової олії в Україні, MOQ до 50 кг", "оливкової олії"],
  ] as const;

  for (const [query, product] of cases) {
    const criteria = deriveSupplierSearchCriteria(query);
    assert.equal(criteria.product, product, query);
    assert.equal(criteria.deliveryRegion, "Україна", query);
    assert.doesNotMatch(criteria.product ?? "", /Україн|достав|MOQ|50\s*кг/iu, query);
  }
});

test("empty or supplier-only intent does not invent a product", () => {
  assert.equal(deriveSupplierSearchCriteria("").product, null);
  assert.equal(deriveSupplierSearchCriteria("Шукаю постачальника в Україні").product, null);
});
