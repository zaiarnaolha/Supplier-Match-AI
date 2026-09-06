export type ExtractedField = { value: string; evidence: string; confidence: "high" | "medium" } | null;

export type PriceBasis = "per_kg" | "per_item" | "per_liter" | "unspecified";
export type CommercialScope = "wholesale" | "retail" | "unspecified";
export interface PriceCandidate {
  displayValue: string;
  /** Canonical base-10 representation; deliberately not a JavaScript number. */
  decimalAmount: string;
  currency: "UAH" | "USD" | "EUR";
  basis: PriceBasis;
  productBinding: string;
  commercialScope: CommercialScope;
  sourceUrl: string;
  evidenceType: "price_label" | "product_local" | "product_title";
  evidenceText: string;
  literalFrom: boolean;
}

export interface MoqCandidate {
  quantity: string;
  unit: "кг" | "шт" | "т" | "г";
  lowerBound: boolean;
  displayValue: string;
  evidence: string;
}

// Enumerable symbols survive object spread, while Object.keys and JSON.stringify
// intentionally ignore them. This keeps evidence internal without making copies lossy.
export const PRICE_CANDIDATES = Symbol("supplierPriceCandidates");
export const MOQ_CANDIDATES = Symbol("supplierMoqCandidates");
export type PriceBearingField = NonNullable<ExtractedField> & { [PRICE_CANDIDATES]?: PriceCandidate[] };
type MoqBearingField = NonNullable<ExtractedField> & { [MOQ_CANDIDATES]?: MoqCandidate[] };

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
const MONEY = /(?:від\s+|from\s+)?(?:(?:[$€]\s*\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?)|(?:\d+(?:[\s.,]\d{3})*(?:[.,]\d+)?\s*(?:грн|₴|uah|usd|eur)))(?:\s*\/\s*(?:1\s*)?(?:кг|kg|шт\.?|pcs?|л|l))?/giu;
const NON_PRODUCT_PAYMENT = /(?:безкоштовн\p{L}*\s+достав|доставк\p{L}*|shipping|free\s+shipping|delivery|купон|coupon|membership|підписк|subscription|комісі|commission|депозит|deposit)/iu;
const ORDER_VALUE = /(?:мінімальн\p{L}*\s+(?:вартість|сума)\s+замовлення|minimum\s+order\s+(?:value|amount)|order\s+minimum)/iu;
const EXPLICIT_OTHER_PRODUCT = /(?:\btea\b|\bчай\p{L}*\b|офісн\p{L}*\s+папір|office\s+paper|detergent|мийн\p{L}*\s+засіб)/iu;
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
    .replace(/kilograms?|кілограм(?:и|ів)?|kg/giu, "кг").replace(/pieces?|pcs?\.?|шт\./giu, "шт").replace(/tonnes?|tons?|тонн?(?:и)?/giu, "т")
    .replace(/grams?|грам(?:и|ів)?/giu, "г");
}

function moqCandidate(raw: string, marker: string, evidence: string): MoqCandidate | null {
  let displayValue = canonicalQuantity(raw);
  const markerLowerBound = /^(?:опт|гуртом)\s+від|wholesale\s+from/iu.test(marker);
  const lowerBound = /^(?:від|from)\s+/iu.test(raw.trim()) || markerLowerBound;
  if (lowerBound && !displayValue.startsWith("від ")) displayValue = `від ${displayValue}`;
  const parsed = displayValue.match(/^(?:від\s+)?(\d+(?:[.,]\d+)?(?:\s*[–—-]\s*\d+(?:[.,]\d+)?)?)\s*(кг|шт|т|г)$/iu);
  if (!parsed) return null;
  const quantity = parsed[1].replace(/\s+/g, "").replace(/,/g, ".").replace(/^0+(?=\d)/u, "");
  return { quantity, unit: parsed[2].toLocaleLowerCase() as MoqCandidate["unit"], lowerBound, displayValue, evidence };
}

export function aggregateMoqCandidates(candidates: MoqCandidate[]): MoqBearingField | null {
  if (!candidates.length) return null;
  const groups = new Map<string, MoqCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.quantity}|${candidate.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  if (groups.size !== 1) return null;
  const group = [...groups.values()][0];
  const selected = group.find(candidate => candidate.lowerBound) ?? group[0];
  const field: MoqBearingField = { value: selected.displayValue, evidence: selected.evidence, confidence: "high" };
  Object.defineProperty(field, MOQ_CANDIDATES, { value: group, enumerable: true });
  return field;
}

export function moqCandidates(field: ExtractedField | undefined): MoqCandidate[] {
  return field ? ((field as MoqBearingField)[MOQ_CANDIDATES] ?? []) : [];
}

export function extractMoq(title: string, content: string): ExtractedField {
  const text = `${title}. ${content}`.replace(/\s+/g, " ");
  const findings: MoqCandidate[] = [];
  for (const marker of text.matchAll(MOQ_MARKER)) {
    const start = marker.index ?? 0;
    const nearby = text.slice(start, start + marker[0].length + 110);
    const quantityMatch = nearby.match(QUANTITY);
    const quantity = quantityMatch?.[0];
    const beforeQuantity = nearby.slice(marker[0].length, quantityMatch?.index);
    if (quantity && !/(?:^|\s)(?:до|max(?:imum)?)(?:\s|$)/iu.test(beforeQuantity)) {
      const candidate = moqCandidate(quantity, marker[0], nearby.trim());
      if (candidate) findings.push(candidate);
    }
  }
  return aggregateMoqCandidates(findings);
}

function cleanPrice(raw: string): string { return raw.trim().replace(/\s+/g, " ").replace(/^from\s+/iu, "від "); }
function isZeroMoney(raw: string): boolean {
  const digits = raw.match(/\d/gu) ?? [];
  return digits.length > 0 && digits.every(digit => digit === "0");
}
function parseDecimal(raw: string): string | null {
  const numeric = raw.match(/\d[\d\s.,]*/u)?.[0]?.replace(/\s/g, "");
  if (!numeric) return null;
  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");
  const separator = Math.max(lastComma, lastDot);
  let integer = numeric;
  let fraction = "";
  if (separator >= 0 && numeric.length - separator - 1 !== 3) {
    integer = numeric.slice(0, separator);
    fraction = numeric.slice(separator + 1);
  }
  integer = integer.replace(/[.,]/g, "").replace(/^0+(?=\d)/u, "") || "0";
  fraction = fraction.replace(/[.,]/g, "").replace(/0+$/u, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

function candidateFrom(raw: string, evidenceText: string, product: NonNullable<ExtractedField>, sourceUrl: string, evidenceType: PriceCandidate["evidenceType"]): PriceCandidate | null {
  const decimalAmount = parseDecimal(raw);
  if (!decimalAmount || /^0(?:\.0*)?$/u.test(decimalAmount)) return null;
  const currency = /(?:грн|₴|uah)/iu.test(raw) ? "UAH" : /\$/u.test(raw) || /usd/iu.test(raw) ? "USD" : /€/u.test(raw) || /eur/iu.test(raw) ? "EUR" : null;
  if (!currency) return null;
  const basis: PriceBasis = /\/\s*(?:1\s*)?(?:кг|kg)/iu.test(raw) ? "per_kg"
    : /\/\s*(?:1\s*)?(?:шт\.?|pcs?)/iu.test(raw) ? "per_item"
      : /\/\s*(?:1\s*)?(?:л|l)/iu.test(raw) ? "per_liter" : "unspecified";
  const wholesale = /(?:оптов\p{L}*|оптом|гуртом|wholesale|b2b)/iu.test(evidenceText);
  const retail = /(?:роздріб\p{L}*|retail)/iu.test(evidenceText);
  const commercialScope: CommercialScope = wholesale === retail ? "unspecified" : wholesale ? "wholesale" : "retail";
  return {
    displayValue: cleanPrice(raw), decimalAmount, currency, basis,
    productBinding: product.value, commercialScope, sourceUrl, evidenceType,
    evidenceText, literalFrom: /^(?:від|from)\s+/iu.test(raw.trim()),
  };
}

function compareDecimals(left: string, right: string): number {
  const [li, lf = ""] = left.split("."); const [ri, rf = ""] = right.split(".");
  if (li.length !== ri.length) return li.length - ri.length;
  const integerOrder = li.localeCompare(ri); if (integerOrder) return integerOrder;
  return lf.padEnd(Math.max(lf.length, rf.length), "0").localeCompare(rf.padEnd(Math.max(lf.length, rf.length), "0"));
}

export function aggregatePriceCandidates(candidates: PriceCandidate[]): PriceBearingField | null {
  if (!candidates.length) return null;
  const groups = new Map<string, PriceCandidate[]>();
  for (const candidate of candidates) {
    const key = [candidate.productBinding.toLocaleLowerCase(), candidate.currency, candidate.basis, candidate.commercialScope].join("|");
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  if (groups.size !== 1) return null;
  const group = [...groups.values()][0];
  const amounts = new Map<string, PriceCandidate>();
  for (const candidate of group) amounts.set(candidate.decimalAmount, candidate);
  const ordered = [...amounts.values()].sort((a, b) => compareDecimals(a.decimalAmount, b.decimalAmount));
  const selected = ordered[0];
  const value = ordered.length > 1
    ? `від ${selected.displayValue.replace(/^(?:від|from)\s+/iu, "")}`
    : selected.displayValue;
  const field: PriceBearingField = { value, evidence: selected.evidenceText, confidence: "high" };
  Object.defineProperty(field, PRICE_CANDIDATES, { value: group, enumerable: true });
  return field;
}

export function priceCandidates(field: ExtractedField | undefined): PriceCandidate[] {
  return field ? ((field as PriceBearingField)[PRICE_CANDIDATES] ?? []) : [];
}

export function extractPrice(title: string, content: string, product: ExtractedField, url: string): ExtractedField {
  const text = `${title}. ${content}`.replace(/\s+/g, " ");
  if (!product) return null;
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
      const candidate = candidateFrom(price[0], nearby, product, url, "price_label");
      if (candidate && !isZeroMoney(price[0])) findings.push(candidate);
    }
  }
  if (findings.length === 0 && product) {
    for (const sentence of text.split(/(?<=[.!?])\s+|\s*[|•]\s*/u)) {
      if (NON_PRODUCT_PAYMENT.test(sentence) || ORDER_VALUE.test(sentence) || !extractProduct(sentence, "", url)) continue;
      const prices = [...sentence.matchAll(MONEY)];
      for (const price of prices) {
        const candidate = candidateFrom(price[0], sentence.trim(), product, url, "product_local");
        if (candidate && !isZeroMoney(price[0])) findings.push(candidate);
      }
    }
  }
  let path = "/";
  try { path = new URL(url).pathname; } catch { /* Invalid URLs cannot establish product-page context. */ }
  if (findings.length === 0 && product && path !== "/") {
    const titlePrices = [...title.matchAll(MONEY)];
    if (titlePrices.length === 1 && !isZeroMoney(titlePrices[0][0]) && !NON_PRODUCT_PAYMENT.test(title) && !ORDER_VALUE.test(title)) {
      const candidate = candidateFrom(titlePrices[0][0], title.trim(), product, url, "product_title");
      if (candidate) findings.push(candidate);
    }
  }
  // Different unscoped labelled prices cannot safely be bound to the same
  // requested variant (for example Arabica versus Robusta). Explicitly scoped
  // observations can proceed to the semantic compatibility checks that follow.
  if (new Set(findings.map(candidate => candidate.decimalAmount)).size > 1
    && findings.some(candidate => candidate.commercialScope === "unspecified")) return null;
  return aggregatePriceCandidates(findings);
}

export function extractSupplierFields(title: string, content: string, url: string) {
  const product = extractProduct(title, content, url);
  return { product, country: extractCountry(title, content, url), moq: extractMoq(title, content), price: extractPrice(title, content, product, url) };
}
