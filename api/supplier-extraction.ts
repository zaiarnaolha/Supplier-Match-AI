export type ExtractedField = { value: string; evidence: string; confidence: "high" | "medium" } | null;

type CanonicalCategory = { canonical: string; aliases: readonly string[] };
type CountryDefinition = { canonical: string; strongSignals: readonly RegExp[]; cities: readonly string[]; domains: readonly string[] };

const PRODUCT_CATEGORIES: readonly CanonicalCategory[] = [{
  canonical: "Кава в зернах",
  aliases: ["whole bean coffee", "кава в зернах", "кави в зернах", "зернова кава", "зернової кави", "coffee beans"],
}];

const COUNTRIES: readonly CountryDefinition[] = [{
  canonical: "Україна",
  strongSignals: [
    /українськ(?:ий|а|е|і)\s+(?:виробник|компані(?:я|ї))/iu,
    /виробник\s+(?:з|із)\s+україни/iu,
    /(?:ukrainian\s+(?:manufacturer|company)|based\s+in\s+ukraine|located\s+in\s+ukraine)/iu,
    /(?:юридична|контактна)\s+адреса[^.!?]{0,100}(?:україна|ukraine)/iu,
    /(?:legal|contact)\s+address[^.!?]{0,100}(?:ukraine|україна)/iu,
  ],
  cities: ["ки(?:їв|єв)\\p{L}*", "kyiv", "льв\\p{L}*", "lviv", "одес\\p{L}*", "odesa", "харків", "kharkiv", "дніпр\\p{L}*", "dnipro"],
  domains: [".ua", ".com.ua"],
}];

const MOQ_MARKER = /(?:minimum\s+order(?:\s+quantity)?|moq|мінімальн(?:е\s+замовлення|а\s+партія)|замовлення\s+від|опт\s+від|гуртом\s+від|wholesale\s+from)/giu;
const QUANTITY = /(?:від\s+|from\s+)?\d+(?:[.,]\d+)?(?:\s*[–—-]\s*\d+(?:[.,]\d+)?)?\s*(?:кг|kg|кілограм(?:и|ів)?|шт\.?|pcs?|pieces?|тонн?(?:и)?|т|g|грам(?:и|ів)?|г)(?=$|[^\p{L}\p{N}])/iu;
const PRICE_MARKER = /(?:оптова\s+ціна|wholesale\s+price|ціна|price|вартість)/giu;
const MONEY = /(?:від\s+|from\s+)?(?:(?:[$€]\s*\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?(?:\s*[–—-]\s*\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?)?)|(?:\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?(?:\s*[–—-]\s*\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?)?\s*(?:грн|₴|uah|usd|eur)))(?:\s*\/\s*(?:кг|kg|шт\.?|pcs?|л|l))?/giu;
const NON_PRODUCT_PAYMENT = /(?:безкоштовн\p{L}*\s+достав|доставк\p{L}*|shipping|free\s+shipping|delivery|купон|coupon|membership|підписк|subscription|комісі|commission|депозит|deposit)/iu;

function normalized(value: string): string { return value.toLocaleLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim(); }
function literalPresent(text: string, phrase: string): boolean {
  const escaped = normalized(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

export function extractProduct(title: string, content: string, url: string): ExtractedField {
  const titleText = normalized(title);
  const contentText = normalized(content);
  const candidates = PRODUCT_CATEGORIES.flatMap(category => category.aliases.map(alias => ({ category, alias })))
    .sort((a, b) => normalized(b.alias).length - normalized(a.alias).length);
  for (const { category, alias } of candidates) {
    if (literalPresent(titleText, alias)) return { value: category.canonical, evidence: `title: ${alias}`, confidence: "high" };
  }
  for (const { category, alias } of candidates) {
    if (literalPresent(contentText, alias)) return { value: category.canonical, evidence: `content: ${alias}`, confidence: "high" };
  }
  void url; // A URL is deliberately never sufficient evidence by itself.
  return null;
}

export function extractCountry(title: string, content: string, url: string): ExtractedField {
  const text = normalized(`${title}. ${content}`);
  const matches: NonNullable<ExtractedField>[] = [];
  for (const country of COUNTRIES) {
    const strong = country.strongSignals.find(pattern => pattern.test(text));
    if (strong) {
      matches.push({ value: country.canonical, evidence: text.match(strong)?.[0] ?? country.canonical, confidence: "high" });
      continue;
    }
    let hostname = "";
    try { hostname = new URL(url).hostname.toLocaleLowerCase(); } catch { /* Invalid URLs provide no domain evidence. */ }
    const city = country.cities.find(candidate => new RegExp(`(?:компані\\p{L}*|company|офіс|office|адреса|address|based|located)[^.!?]{0,45}${candidate}|${candidate}[^.!?]{0,45}(?:компані\\p{L}*|company|офіс|office|адреса|address)`, "iu").test(text));
    const domain = country.domains.find(suffix => hostname.endsWith(suffix));
    if (city && domain) matches.push({ value: country.canonical, evidence: `${city} + ${domain}`, confidence: "medium" });
  }
  return new Set(matches.map(match => match.value)).size === 1 ? matches[0] : null;
}

function canonicalQuantity(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").replace(/^from\s+/iu, "від ")
    .replace(/kilograms?|кілограм(?:и|ів)?|kg/giu, "кг").replace(/pieces?|pcs?\.?/giu, "шт").replace(/tonnes?|tons?|тонн?(?:и)?/giu, "т");
}

export function extractMoq(title: string, content: string): ExtractedField {
  const text = `${title}. ${content}`.replace(/\s+/g, " ");
  const findings: Array<{ value: string; evidence: string }> = [];
  for (const marker of text.matchAll(MOQ_MARKER)) {
    const start = marker.index ?? 0;
    const nearby = text.slice(start, start + marker[0].length + 55);
    const quantity = nearby.match(QUANTITY)?.[0];
    if (quantity) {
      let value = canonicalQuantity(quantity);
      if (/^(?:опт|гуртом)\s+від|wholesale\s+from/iu.test(marker[0]) && !value.startsWith("від ")) value = `від ${value}`;
      findings.push({ value, evidence: nearby.trim() });
    }
  }
  const distinct = new Map(findings.map(item => [item.value.toLocaleLowerCase(), item]));
  if (distinct.size !== 1) return null;
  return { ...[...distinct.values()][0], confidence: "high" };
}

function cleanPrice(raw: string): string { return raw.trim().replace(/\s+/g, " ").replace(/^from\s+/iu, "від "); }
export function extractPrice(title: string, content: string, product: ExtractedField, url: string): ExtractedField {
  const text = `${title}. ${content}`.replace(/\s+/g, " ");
  const findings: Array<{ value: string; evidence: string }> = [];
  for (const marker of text.matchAll(PRICE_MARKER)) {
    const markerIndex = marker.index ?? 0;
    const sentenceStart = Math.max(text.lastIndexOf(".", markerIndex - 1) + 1, 0);
    const nextPeriod = text.indexOf(".", markerIndex);
    const sentenceEnd = nextPeriod < 0 ? text.length : nextPeriod;
    const nearby = text.slice(sentenceStart, sentenceEnd).trim();
    if (NON_PRODUCT_PAYMENT.test(nearby)) continue;
    const prices = [...nearby.matchAll(MONEY)];
    if (prices.length === 1) findings.push({ value: cleanPrice(prices[0][0]), evidence: nearby.trim() });
  }
  let path = "/";
  try { path = new URL(url).pathname; } catch { /* Invalid URLs cannot establish product-page context. */ }
  if (findings.length === 0 && product && path !== "/") {
    const titlePrices = [...title.matchAll(MONEY)];
    if (titlePrices.length === 1 && !NON_PRODUCT_PAYMENT.test(title)) findings.push({ value: cleanPrice(titlePrices[0][0]), evidence: title.trim() });
  }
  const distinct = new Map(findings.map(item => [item.value.toLocaleLowerCase(), item]));
  if (distinct.size !== 1) return null;
  return { ...[...distinct.values()][0], confidence: "high" };
}

export function extractSupplierFields(title: string, content: string, url: string) {
  const product = extractProduct(title, content, url);
  return { product, country: extractCountry(title, content, url), moq: extractMoq(title, content), price: extractPrice(title, content, product, url) };
}
