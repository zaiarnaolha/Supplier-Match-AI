import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("SupplierCard does not render supplier location or a location placeholder", async () => {
  const source = await readFile(new URL("../src/pages/SupplierSearchPage/SupplierSearchPage.tsx", import.meta.url), "utf8");
  const card = source.slice(source.indexOf("function SupplierCard"), source.indexOf("function isSpecificRequest"));
  assert.doesNotMatch(card, /supplier\.location|MapPin|Не вказано/);
  assert.match(card, /supplier\.name/);
});
