export type ExtractedField = { value: string; evidence: string; confidence: "high" | "medium" } | null;

export type PriceCurrency = "UAH" | "USD" | "EUR";
export type PriceScope = "wholesale" | "retail" | "unspecified";
export type PriceEvidenceType = "labelled" | "product_local" | "product_title";

/** Decimal money is stored as an integer coefficient and scale, never as a Number. */
export interface PriceCandidate {
  displayValue: string;
  amount: { coefficient: bigint; scale: number };
  currency: PriceCurrency;
  basis: string | null;
  productBinding: string;
  commercialScope: PriceScope;
  sourceUrl: string;
  evidenceType: PriceEvidenceType;
  evidence: string;
  sourceExpressedFrom: boolean;
}

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

const MOQ_MARKER = /(?:minimum\s+order(?:\s+quantity)?|moq|мінімальн(?:е\s+замовлення|а\s+партія|ий\s+обсяг|ого\s+обсягу)|замовлення\s+від|опт\s+від|гуртом\s+від|wholesale\s+from)/giu;
const QUANTITY = /(?:від\s+|from\s+)?\d+(?:[.,]\d+)?(?:\s*[–—-]\s*\d+(?:[.,]\d+)?)?\s*(?:кг|kg|кілограм(?:и|ів)?|шт\.?|pcs?|pieces?|тонн?(?:и)?|т|g|грам(?:и|ів)?|г)(?=$|[^\p{L}\p{N}])/iu;
const PRICE_MARKER = /(?:оптова\s+ціна|wholesale\s+price|ціна|price|вартість)/giu;
const MONEY = /(?:від\s+|from\s+)?(?:(?:[$€]\s*\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?(?:\s*[–—-]\s*\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?)?)|(?:\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?(?:\s*[–—-]\s*\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?)?\s*(?:грн|₴|uah|usd|eur)))(?:\s*\/\s*(?:1\s*)?(?:кг|kg|шт\.?|pcs?|л|l))?/giu;
const NON_PRODUCT_PAYMENT = /(?:безкоштовн\p{L}*\s+достав|доставк\p{L}*|shipping|free\s+shipping|delivery|купон|coupon|membership|підписк|subscription|комісі|commission|депозит|deposit)/iu;
const ORDER_VALUE = /(?:мінімальн\p{L}*\s+(?:вартість|сума)\s+замовлення|minimum\s+order\s+(?:value|amount)|order\s+minimum)/iu;
const EXPLICIT_OTHER_PRODUCT = /(?:\btea\b|\bчай\b|офісн\p{L}*\s+папір|office\s+paper|detergent|мий(?:ний|ні)\s+засіб)/iu;
const UNAMBIGUOUS_WHOLESALE_COFFEE = /(?:кава[^.!?]{0,55}(?:оптом|гуртом|оптов\p{L}*|постачальник|виробник|для\s+бізнес(?:у|ів)|horeca)|(?:оптом|гуртом|оптов\p{L}*|постачальник|виробник|horeca)[^.!?]{0,55}кава)/iu;

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
  const combinedText = normalized(`${title}. ${content}`);
  const wholesaleCoffee = combinedText.match(UNAMBIGUOUS_WHOLESALE_COFFEE)?.[0];
  if (wholesaleCoffee) {
    return { value: "Кава в зернах", evidence: wholesaleCoffee, confidence: "medium" };
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
    const nearby = text.slice(start, start + marker[0].length + 110);
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
function isZeroMoney(raw: string): boolean {
  const digits = raw.match(/\d/gu) ?? [];
  return digits.length > 0 && digits.every(digit => digit === "0");
}
function decimalAmount(raw: string): PriceCandidate["amount"] | null {
  const numeric = raw.match(/\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?/u)?.[0];
  if (!numeric) return null;
  const compact = numeric.replace(/\s/g, "");
  const separator = Math.max(compact.lastIndexOf("."), compact.lastIndexOf(","));
  const decimalSeparator = separator >= 0 && compact.length - separator - 1 !== 3 ? separator : -1;
  const whole = (decimalSeparator < 0 ? compact : compact.slice(0, decimalSeparator)).replace(/[.,]/g, "");
  const fraction = decimalSeparator < 0 ? "" : compact.slice(decimalSeparator + 1);
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function currencyOf(raw: string): PriceCurrency | null {
  if (/\$|\busd\b/iu.test(raw)) return "USD";
  if (/€|\beur\b/iu.test(raw)) return "EUR";
  return /₴|грн|\buah\b/iu.test(raw) ? "UAH" : null;
}

function basisOf(raw: string, evidence: string): string | null {
  const unit = raw.match(/\/\s*(?:1\s*)?(кг|kg|шт\.?|pcs?|л|l)(?=$|[^\p{L}])/iu)?.[1]?.toLocaleLowerCase();
  if (unit) return /^(?:кг|kg)$/u.test(unit) ? "per_kg" : /^(?:шт|pcs?\.?)$/u.test(unit) ? "per_item" : "per_litre";
  const packageSize = evidence.match(/\b(\d+(?:[.,]\d+)?)\s*(кг|kg|г|g|гр|gram(?:s)?)\b/iu);
  return packageSize ? `package:${packageSize[1].replace(",", ".")}${packageSize[2].toLocaleLowerCase()}` : null;
}

function scopeOf(evidence: string): PriceScope {
  if (/(?:опт|гурт|wholesale|b2b|horeca)/iu.test(evidence)) return "wholesale";
  if (/(?:роздріб|retail)/iu.test(evidence)) return "retail";
  return "unspecified";
}

function candidate(raw: string, evidence: string, evidenceType: PriceEvidenceType, product: NonNullable<ExtractedField>, url: string): PriceCandidate | null {
  const amount = decimalAmount(raw);
  const currency = currencyOf(raw);
  if (!amount || amount.coefficient === 0n || !currency) return null;
  return {
    displayValue: cleanPrice(raw), amount, currency, basis: basisOf(raw, evidence),
    productBinding: product.value, commercialScope: scopeOf(evidence), sourceUrl: url,
    evidenceType, evidence: evidence.trim(), sourceExpressedFrom: /^(?:від|from)\s+/iu.test(raw.trim()),
  };
}

function decimalKey(amount: PriceCandidate["amount"]): string {
  let coefficient = amount.coefficient;
  let scale = amount.scale;
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale -= 1; }
  return `${coefficient}:${scale}`;
}

export function comparablePriceCandidates(candidates: PriceCandidate[]): boolean {
  if (candidates.length < 2) return true;
  const first = candidates[0];
  return candidates.every(item => item.currency === first.currency && item.basis === first.basis
    && item.productBinding === first.productBinding && item.commercialScope === first.commercialScope);
}

export function formatPriceCandidates(observations: PriceCandidate[]): ExtractedField {
  const distinct = new Map<string, PriceCandidate>();
  for (const item of observations) {
    const key = [decimalKey(item.amount), item.currency, item.basis ?? "", item.productBinding, item.commercialScope].join("|");
    if (!distinct.has(key)) distinct.set(key, item);
  }
  const candidates = [...distinct.values()];
  if (candidates.length === 0 || !comparablePriceCandidates(candidates)) return null;
  const lowest = candidates.reduce((best, item) => {
    const scale = Math.max(best.amount.scale, item.amount.scale);
    const left = best.amount.coefficient * 10n ** BigInt(scale - best.amount.scale);
    const right = item.amount.coefficient * 10n ** BigInt(scale - item.amount.scale);
    return right < left ? item : best;
  });
  const computedFrom = candidates.length > 1;
  const value = computedFrom && !lowest.sourceExpressedFrom ? `від ${lowest.displayValue}` : lowest.displayValue;
  return { value, evidence: lowest.evidence, confidence: "high" };
}

export function extractPriceCandidates(title: string, content: string, product: ExtractedField, url: string): PriceCandidate[] {
  if (!product) return [];
  const text = `${title}. ${content}`.replace(/\s+/g, " ");
  const findings: PriceCandidate[] = [];
  for (const marker of text.matchAll(PRICE_MARKER)) {
    const markerIndex = marker.index ?? 0;
    const sentenceStart = Math.max(text.lastIndexOf(".", markerIndex - 1) + 1, 0);
    const nextPeriod = text.indexOf(".", markerIndex);
    const sentenceEnd = nextPeriod < 0 ? text.length : nextPeriod;
    const nearby = text.slice(sentenceStart, sentenceEnd).trim();
    if (NON_PRODUCT_PAYMENT.test(nearby) || ORDER_VALUE.test(nearby) || EXPLICIT_OTHER_PRODUCT.test(nearby)) continue;
    const prices = [...nearby.matchAll(MONEY)];
    for (const price of prices) {
      if (!isZeroMoney(price[0])) { const item = candidate(price[0], nearby, "labelled", product, url); if (item) findings.push(item); }
    }
  }
  // Multiple otherwise-unbound exact values remain ambiguous. Explicitly scoped
  // wholesale/retail observations proceed to semantic comparison instead.
  const labelledEvidence = new Set(findings.filter(item => item.evidenceType === "labelled").map(item => item.evidence));
  const labelledValues = new Set(findings.filter(item => item.evidenceType === "labelled").map(item => decimalKey(item.amount)));
  if (labelledEvidence.size > 1 && labelledValues.size > 1
    && findings.every(item => item.commercialScope === "unspecified")) return [];
  if (findings.length === 0 && product) {
    for (const sentence of text.split(/(?<=[.!?])\s+|\s*[|•]\s*/u)) {
      if (NON_PRODUCT_PAYMENT.test(sentence) || ORDER_VALUE.test(sentence) || !extractProduct(sentence, "", url)) continue;
      const prices = [...sentence.matchAll(MONEY)];
      if (prices.length === 1 && !isZeroMoney(prices[0][0])) { const item = candidate(prices[0][0], sentence, "product_local", product, url); if (item) findings.push(item); }
    }
  }
  let path = "/";
  try { path = new URL(url).pathname; } catch { /* Invalid URLs cannot establish product-page context. */ }
  if (findings.length === 0 && product && path !== "/") {
    const titlePrices = [...title.matchAll(MONEY)];
    if (titlePrices.length === 1 && !isZeroMoney(titlePrices[0][0]) && !NON_PRODUCT_PAYMENT.test(title) && !ORDER_VALUE.test(title)) {
      const item = candidate(titlePrices[0][0], title, "product_title", product, url); if (item) findings.push(item);
    }
  }
  return findings;
}

export function extractPrice(title: string, content: string, product: ExtractedField, url: string): ExtractedField {
  return formatPriceCandidates(extractPriceCandidates(title, content, product, url));
}

export function extractSupplierFields(title: string, content: string, url: string) {
  const product = extractProduct(title, content, url);
  return { product, country: extractCountry(title, content, url), moq: extractMoq(title, content), price: extractPrice(title, content, product, url) };
}
