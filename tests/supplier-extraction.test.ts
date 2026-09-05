import assert from "node:assert/strict";
import test from "node:test";
import { extractCountry, extractMoq, extractPrice, extractPriceCandidates, extractProduct, extractSupplierFields } from "../api/supplier-extraction.ts";
import { tavilySnippets } from "./fixtures/tavily-snippets.ts";

const url = "https://supplier.example.com/catalog/coffee";

test("canonicalizes an inflected coffee category instead of returning one word", () => {
  const fixture = tavilySnippets.inflectedCoffee;
  assert.equal(extractProduct(fixture.title, fixture.content, fixture.url)?.value, "Кава в зернах");
  assert.notEqual(extractProduct("Кави в зернах оптом", "", url)?.value, "кави");
});

test("supports English and Ukrainian aliases from title or content", () => {
  assert.equal(extractProduct("Wholesale supplier", "We roast whole bean coffee for shops.", url)?.value, "Кава в зернах");
  assert.equal(extractProduct("Зернова кава", "", url)?.value, "Кава в зернах");
});

test("recognizes an unambiguous supplier coffee-wholesale page as the requested coffee category", () => {
  const extracted = extractProduct(
    "Кава оптом від українського виробника Royal Life",
    "Цікавить кава, купити оптом яку пропонує постачальник Роял Лайф? Стабільні поставки для бізнесу.",
    "https://royal-life.ua/kava-optom",
  );
  assert.equal(extracted?.value, "Кава в зернах");
  assert.equal(extracted?.confidence, "medium");
  assert.equal(extractProduct("Чай оптом", "До кави пропонуємо печиво.", url), null);
});

test("does not infer product from an unrelated page or URL alone", () => {
  assert.equal(extractProduct("Постачальник для HoReCa", "Широкий каталог", url), null);
});

test("does not mistake package size for MOQ", () => {
  const fixture = tavilySnippets.packageSize;
  assert.equal(extractMoq(fixture.title, fixture.content), null);
  assert.equal(extractMoq("Фасування 1 кг", "Кава для офісу"), null);
  assert.equal(extractMoq("Кава", "Упаковка 1 кг × 10"), null);
});

test("extracts and normalizes explicit minimum order quantities", () => {
  const fixture = tavilySnippets.wholesaleMoq;
  assert.equal(extractMoq(fixture.title, fixture.content)?.value, "від 20 кг");
  assert.equal(extractMoq("Coffee", "MOQ: 50 kg")?.value, "50 кг");
  assert.equal(extractMoq("Coffee", "Minimum order quantity 100 pcs")?.value, "100 шт");
  assert.equal(extractMoq("Royal Life", "Мінімальний обсяг для отримання оптових умов у Royal Life починається від 30 кг.")?.value, "від 30 кг");
});

test("returns null for absent and ambiguous MOQ", () => {
  assert.equal(extractMoq("Продаж оптом", "Звертайтеся до менеджера"), null);
  assert.equal(extractMoq("Каталог", "MOQ 10 кг для арабіки. MOQ 20 кг для робусти."), null);
});

test("rejects delivery thresholds as product prices and MOQ", () => {
  const fixture = tavilySnippets.shippingThreshold;
  assert.equal(extractPrice(fixture.title, fixture.content, null, fixture.url), null);
  assert.equal(extractMoq(fixture.title, fixture.content), null);
});

test("extracts explicit product price with currency and unit", () => {
  const fixture = tavilySnippets.wholesalePrice;
  const product = extractProduct(fixture.title, fixture.content, fixture.url);
  assert.equal(extractPrice(fixture.title, fixture.content, product, fixture.url)?.value, "320 грн/кг");
  assert.equal(extractPrice("Coffee beans", "Wholesale price $10/kg", product, url)?.value, "$10/kg");
});

test("keeps exact, sourced-from, and computed-from price semantics distinct", () => {
  const product = extractProduct("Whole bean coffee", "", url);
  assert.equal(extractPrice("Whole bean coffee", "Price 600 грн", product, url)?.value, "600 грн");
  const sourced = extractPriceCandidates("Whole bean coffee", "Price від 535 грн/кг", product, url);
  assert.equal(extractPrice("Whole bean coffee", "Price від 535 грн/кг", product, url)?.value, "від 535 грн/кг");
  assert.equal(sourced[0].sourceExpressedFrom, true);
  assert.equal(extractPrice("Whole bean coffee", "Wholesale prices: 616 грн/кг, 660 грн/кг, 704 грн/кг, 792 грн/кг", product, url)?.value, "від 616 грн/кг");
  assert.equal(extractPrice("Whole bean coffee", "Wholesale price 616 UAH / 1 kg. Wholesale price 660 UAH / 1 kg. Wholesale price 704 UAH / 1 kg.", product, url)?.value, "від 616 UAH / 1 kg");
});

test("deduplicates observations and refuses incompatible price groups", () => {
  const product = extractProduct("Whole bean coffee", "", url);
  assert.equal(extractPrice("Whole bean coffee", "Price 600 грн/кг. Price 600,00 UAH/kg.", product, url)?.value, "600 грн/кг");
  assert.equal(extractPrice("Whole bean coffee", "Price 600 UAH. Price 20 USD.", product, url), null);
  assert.equal(extractPrice("Whole bean coffee", "Price 600 грн/кг. Price 300 грн/шт.", product, url), null);
  assert.equal(extractPrice("Whole bean coffee", "Retail price 300 UAH. Wholesale price 600 UAH.", product, url), null);
  assert.equal(extractPrice("Whole bean coffee", "250 g package price 180 грн. 1000 g package price 600 грн.", product, url), null);
});

test("keeps unsafe monetary evidence out of structured candidates", () => {
  const product = extractProduct("Whole bean coffee", "", url);
  assert.equal(extractPrice("Whole bean coffee", "Price 0,00 грн. Coffee price 600 грн/кг.", product, url)?.value, "600 грн/кг");
  assert.equal(extractPrice("Whole bean coffee", "Delivery price 100 грн. Coffee price 600 грн/кг.", product, url)?.value, "600 грн/кг");
  assert.equal(extractPrice("Whole bean coffee", "Minimum order value 700 грн. Coffee price 620 грн/кг.", product, url)?.value, "620 грн/кг");
  assert.equal(extractPrice("Whole bean coffee", "Tea price 200 грн. Coffee has flexible terms.", product, url), null);
  assert.equal(extractPrice("Whole bean coffee", "Coffee options 500 грн and 600 грн.", product, url), null);
});

test("extracts Ukrainian product-local prices without requiring a price label", () => {
  for (const price of ["670 грн", "750,00 грн", "900,00 грн", "1 100,00 грн"]) {
    const product = extractProduct("Кава в зернах", "", url);
    assert.equal(extractPrice("Кава в зернах", `Кава в зернах TESORO ${price}`, product, url)?.value, price);
  }
});

test("rejects exactly zero monetary amounts without rejecting positive prices", () => {
  const product = extractProduct("Кава в зернах", "", url);
  for (const price of ["0 грн", "0,00 грн", "0.00 грн", "0 UAH", "0.00 UAH", "$0", "$0.00", "€0"]) {
    assert.equal(extractPrice("Кава в зернах", `Ціна ${price}`, product, url), null, price);
  }
  for (const price of ["0,50 грн", "600 грн"]) {
    assert.equal(extractPrice("Кава в зернах", `Ціна ${price}`, product, url)?.value, price);
  }
  assert.equal(extractPrice("Кава в зернах 295.00 UAH", "", product, url)?.value, "295.00 UAH");
});

test("rejects an unlabeled delivery fee and a price tied to another product", () => {
  const product = extractProduct("Кава в зернах", "", url);
  assert.equal(extractPrice("Кава в зернах", "Доставка для кави в зернах 200 грн", product, url), null);
  assert.equal(extractPrice("Кава в зернах", "Чай Assam 670 грн", product, url), null);
});

test("rejects non-product fees, discounts, and ambiguous prices", () => {
  const product = extractProduct("Кава в зернах", "", url);
  assert.equal(extractPrice("Кава", "Вартість доставки 200 грн", product, url), null);
  assert.equal(extractPrice("Кава", "Знижка -14%", product, url), null);
  assert.equal(extractPrice("Каталог", "Ціна арабіки 320 грн. Ціна робусти 280 грн.", product, url), null);
});

test("recognizes strong supplier-country evidence", () => {
  const fixture = tavilySnippets.supplierCountry;
  assert.equal(extractCountry(fixture.title, fixture.content, fixture.url)?.value, "Україна");
  assert.equal(extractCountry("About", "Ukrainian company producing coffee", url)?.value, "Україна");
});

test("does not use origin, delivery geography, query geography, or domain alone as country", () => {
  const origin = tavilySnippets.productOrigin;
  assert.equal(extractCountry(origin.title, origin.content, origin.url), null);
  assert.equal(extractCountry("Доставка по Україні", "Безкоштовна доставка по Києву", url), null);
  assert.equal(extractCountry("Coffee", "Beans from Colombia", "https://shop.com.ua"), null);
});

test("combines independent company-city and Ukrainian-domain signals", () => {
  assert.deepEqual(extractCountry("Про нас", "Наша компанія в Києві працює з 2010 року", "https://coffee.com.ua")?.value, "Україна");
  assert.equal(extractCountry("Про нас", "Наша компанія в Києві", "https://coffee.com"), null);
});

test("returns only public nullable values from the composed extraction", () => {
  const fields = extractSupplierFields("Кави в зернах", "Український виробник. Опт від 20 кг. Оптова ціна 320 грн/кг.", url);
  assert.deepEqual(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field?.value ?? null])), {
    product: "Кава в зернах", country: "Україна", moq: "від 20 кг", price: "320 грн/кг",
  });
});
