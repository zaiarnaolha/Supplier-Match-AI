import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("SupplierCard does not render supplier location or a location placeholder", async () => {
  const source = await readFile(new URL("../src/pages/SupplierSearchPage/SupplierSearchPage.tsx", import.meta.url), "utf8");
  const card = source.slice(source.indexOf("function SupplierCard"), source.indexOf("function isSpecificRequest"));
  assert.doesNotMatch(card, /supplier\.location|MapPin|Не вказано/);
  assert.match(card, /supplier\.name/);
});

test("SupplierCard does not render a supplier update date", async () => {
  const source = await readFile(new URL("../src/pages/SupplierSearchPage/SupplierSearchPage.tsx", import.meta.url), "utf8");
  const card = source.slice(source.indexOf("function SupplierCard"), source.indexOf("function isSpecificRequest"));
  assert.doesNotMatch(card, /supplier\.updatedAt|Оновлено/);
});

test("public supplier criteria omit MOQ across cards, compare, and details data", async () => {
  const searchPage = await readFile(new URL("../src/pages/SupplierSearchPage/SupplierSearchPage.tsx", import.meta.url), "utf8");
  const comparePage = await readFile(new URL("../src/pages/CompareScreen/CompareScreen.tsx", import.meta.url), "utf8");
  const supplierData = await readFile(new URL("../src/data/suppliers.ts", import.meta.url), "utf8");

  assert.doesNotMatch(searchPage, /label: ['"]MOQ['"]|result\.moq/);
  assert.doesNotMatch(comparePage, /['"]MOQ['"]/);
  assert.doesNotMatch(supplierData, /label: ['"]MOQ['"]/);
});
