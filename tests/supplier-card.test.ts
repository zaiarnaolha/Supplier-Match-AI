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

test("SupplierSearchPage omits desktop and mobile supplier filter controls", async () => {
  const source = await readFile(new URL("../src/pages/SupplierSearchPage/SupplierSearchPage.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /function Filters|styles\.(?:filters|mobileFilters|filterFields|clearFilters)/);
  assert.doesNotMatch(source, /Категорія|Країна \/ регіон|Очистити фільтри|SlidersHorizontal/);
  assert.doesNotMatch(source, /До 300 грн\/кг|До 500 грн\/кг|label: ['"]MOQ['"]|result\.moq/);
});

test("search request, result mapping, supplier cards, and compare flow remain connected", async () => {
  const source = await readFile(new URL("../src/pages/SupplierSearchPage/SupplierSearchPage.tsx", import.meta.url), "utf8");

  assert.match(source, /buildSupplierSearchRequest\(query, region\)/);
  assert.match(source, /body: JSON\.stringify\(requestBody\)/);
  assert.match(source, /setSearchResults\(results\.map\(mapSearchResult\)\)/);
  assert.match(source, /result\.delivery\.status === 'confirmed'/);
  assert.match(source, /label: 'Ціна', value: result\.price/);
  assert.match(source, /searchResults\.map\(supplier => <SupplierCard/);
  assert.match(source, /selectedSuppliers\.length >= 3/);
  assert.match(source, /selectedSuppliers\.length >= 2/);
  assert.match(source, /navigate\('\/app\/compare'\)/);
  assert.match(source, /navigate\(`\/app\/suppliers\/\$\{supplier\.id\}`\)/);
});
