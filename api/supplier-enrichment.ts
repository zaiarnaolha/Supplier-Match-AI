import { extractMoq, extractPrice, extractProduct, type ExtractedField } from "./supplier-extraction";
import { canonicalSupplierDomain } from "./supplier-identity";

export type DeliveryStatus = "confirmed" | "not_confirmed" | "not_available";
export type EvidenceSource = "official" | "external";

export interface DeliveryVerification {
  region: string;
  status: DeliveryStatus;
  evidence: string | null;
  sourceUrl: string | null;
  sourceType: EvidenceSource | null;
}

export interface EnrichmentResult {
  product: string | null;
  moq: string | null;
  price: string | null;
  supplierLocation: string | null;
  delivery: DeliveryVerification;
}

export interface EnrichmentSearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export type EnrichmentSearch = (
  query: string,
  options: { includeDomains?: string[]; maxResults: number },
) => Promise<EnrichmentSearchResult[]>;

export type EnrichmentDiagnostics = (
  stage: "official" | "external",
  payload: Record<string, unknown>,
) => void;

type SourcedField = ExtractedField & { sourceUrl?: string };

const GENERIC_EXTERNAL = /(?:top|топ|rating|рейтинг|best|кращі|list of|список|directory|каталог)\s*(?:\d+\s*)?(?:coffee\s*)?(?:suppliers?|manufacturers?|постачальник\p{L}*|виробник\p{L}*)/iu;
const DELIVERY_WORD = /(?:deliver(?:y|ies|ed|ing)?|ship(?:ping|s|ped)?|supply|достав(?:ка|ляємо|ляє|ляють|ити|ки|ку)|постав(?:ка|ляємо|ляє|ляють|ки|ку))/iu;
const NEGATIVE_DELIVERY = /(?:do(?:es)?\s+not|don['’]?t|cannot|can['’]?t|not\s+available|не\s+(?:доставля\p{L}*|постачає\p{L}*)|доставка\s+недоступна|не\s+обслуговує\p{L}*)/iu;
const LOCATION_LABEL = /(?:legal|registered|contact|business)\s+address|headquarters|юридична\s+адреса|адреса\s+(?:компанії|офісу)|головний\s+офіс/iu;
const LOCATION_VALUE = /(?:[\p{L}.'’ -]+,\s*)?(?:ukraine|україна|poland|польща|germany|німеччина|romania|румунія|slovakia|словаччина|czechia|чехія)/iu;
const CHROME_GARBAGE = /(?:карта\s+сайту|site\s*map|breadcrumbs?|меню|menu|контакти\s+м|©|privacy|політика)/iu;

function textOf(result: EnrichmentSearchResult): string {
  return `${result.title}. ${result.content}`.replace(/\s+/g, " ").trim();
}

function normalizeIdentity(value: string): string {
  return value.toLocaleLowerCase().replace(/^www\./, "").replace(/[^\p{L}\p{N}.]+/gu, " ").trim();
}

function hostname(url: string): string {
  try { return new URL(url).hostname.toLocaleLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function regionPattern(region: string): RegExp | null {
  const normalized = region.trim();
  if (!normalized || /^(?:anywhere|будь-яка країна)$/iu.test(normalized)) return null;
  const aliases: Record<string, string[]> = {
    ukraine: ["ukraine", "україна", "україні", "україну"],
    україна: ["ukraine", "україна", "україні", "україну"],
  };
  const values = aliases[normalized.toLocaleLowerCase()] ?? [normalized];
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${values.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=$|[^\\p{L}\\p{N}])`, "iu");
}

function supplierIdentityPresent(result: EnrichmentSearchResult, supplierName: string, supplierHostname: string): boolean {
  const text = normalizeIdentity(textOf(result));
  const name = normalizeIdentity(supplierName);
  const domain = normalizeIdentity(supplierHostname);
  return (name.length >= 4 && text.includes(name)) || (domain.length >= 4 && (text.includes(domain) || hostname(result.url) === domain));
}

function identityMatchKind(
  result: EnrichmentSearchResult,
  supplierName: string,
  supplierHostname: string,
): "company_name" | "hostname" | "neither" {
  const text = normalizeIdentity(textOf(result));
  const name = normalizeIdentity(supplierName);
  const domain = normalizeIdentity(supplierHostname);
  if (name.length >= 4 && text.includes(name)) return "company_name";
  if (domain.length >= 4 && (text.includes(domain) || hostname(result.url) === domain)) return "hostname";
  return "neither";
}

function deliverySignal(result: EnrichmentSearchResult, region: string): { negative: boolean; evidence: string } | null {
  const text = textOf(result);
  const regionRegex = regionPattern(region);
  if (!regionRegex) return null;
  for (const sentence of text.split(/(?<=[.!?])\s+|\s*[|•]\s*/u)) {
    if (!regionRegex.test(sentence) || !DELIVERY_WORD.test(sentence)) continue;
    return { negative: NEGATIVE_DELIVERY.test(sentence), evidence: sentence.slice(0, 280) };
  }
  return null;
}

function explicitLocation(result: EnrichmentSearchResult): SourcedField {
  const text = textOf(result);
  for (const sentence of text.split(/(?<=[.!?])\s+|\s*[|•]\s*/u)) {
    if (!LOCATION_LABEL.test(sentence) || CHROME_GARBAGE.test(sentence)) continue;
    const label = sentence.match(LOCATION_LABEL);
    if (!label || label.index === undefined) continue;
    const afterLabel = sentence.slice(label.index + label[0].length).replace(/^\s*[:—-]\s*/, "").trim();
    const location = afterLabel.match(LOCATION_VALUE)?.[0]?.trim();
    if (location && location.length >= 3 && location.length <= 100 && !CHROME_GARBAGE.test(location)) {
      return { value: location, evidence: sentence.slice(0, 280), confidence: "high", sourceUrl: result.url };
    }
  }
  return null;
}

function oneValue(fields: SourcedField[]): SourcedField {
  const values = new Map(fields.filter(Boolean).map(field => [field!.value.toLocaleLowerCase(), field!]));
  return values.size === 1 ? [...values.values()][0] : null;
}

function diagnosticEvaluation(
  result: EnrichmentSearchResult,
  context: { supplierName: string; supplierHostname: string; deliveryRegion: string; sourceType: EvidenceSource },
) {
  const text = textOf(result);
  const identityMatchedBy = identityMatchKind(result, context.supplierName, context.supplierHostname);
  const genericRejected = GENERIC_EXTERNAL.test(text);
  const product = extractProduct(result.title, result.content, result.url);
  const moq = product ? extractMoq(result.title, result.content) : null;
  const price = product ? extractPrice(result.title, result.content, product, result.url) : null;
  const location = explicitLocation(result);
  const regionMatched = regionPattern(context.deliveryRegion)?.test(text) ?? false;
  const deliveryContextMatched = DELIVERY_WORD.test(text);
  const delivery = deliverySignal(result, context.deliveryRegion);
  const officialDomainMatched = canonicalSupplierDomain(hostname(result.url)) === canonicalSupplierDomain(context.supplierHostname);
  const identityMatched = identityMatchedBy !== "neither";
  const eligible = context.sourceType === "official"
    ? officialDomainMatched
    : identityMatched && !genericRejected;
  let rejectionReason: string | null = null;
  if (context.sourceType === "official" && !officialDomainMatched) rejectionReason = "result is outside canonical supplier hostname";
  else if (context.sourceType === "external" && genericRejected) rejectionReason = "generic/list/directory result";
  else if (context.sourceType === "external" && !identityMatched) rejectionReason = "supplier identity not matched";
  else if (!regionMatched) rejectionReason = "deliveryRegion not matched";
  else if (!deliveryContextMatched) rejectionReason = "delivery context not matched";

  return {
    title: result.title,
    url: result.url,
    hostname: hostname(result.url),
    supplierIdentityMatched: identityMatched,
    identityMatchedBy,
    genericRejected,
    requestedProductMatched: Boolean(product),
    deliveryRegionMatched: regionMatched,
    deliveryContextMatched,
    positiveDeliveryEvidence: Boolean(delivery && !delivery.negative),
    negativeDeliveryEvidence: Boolean(delivery?.negative),
    acceptedAsDeliveryEvidence: Boolean(eligible && delivery),
    rejectionReason,
    productCandidate: product?.value ?? null,
    moqCandidate: moq?.value ?? null,
    priceCandidate: price?.value ?? null,
    supplierLocationCandidate: location?.value ?? null,
    deliveryEvidenceCandidate: delivery?.evidence ?? null,
  };
}

export function extractVerifiedEnrichment(
  results: EnrichmentSearchResult[],
  context: { supplierName: string; supplierHostname: string; deliveryRegion: string; sourceType: EvidenceSource },
): EnrichmentResult {
  const eligible = results.filter(result => context.sourceType === "official"
    ? canonicalSupplierDomain(hostname(result.url)) === canonicalSupplierDomain(context.supplierHostname)
    : !GENERIC_EXTERNAL.test(textOf(result)) && supplierIdentityPresent(result, context.supplierName, context.supplierHostname));
  const productFields: SourcedField[] = [];
  const moqFields: SourcedField[] = [];
  const priceFields: SourcedField[] = [];
  const locationFields: SourcedField[] = [];
  const deliverySignals: Array<{ negative: boolean; evidence: string; url: string }> = [];

  for (const result of eligible) {
    const product = extractProduct(result.title, result.content, result.url);
    if (product) productFields.push({ ...product, sourceUrl: result.url });
    // MOQ and price require product evidence in this exact result, avoiding values for another product.
    if (product) {
      const moq = extractMoq(result.title, result.content);
      const price = extractPrice(result.title, result.content, product, result.url);
      if (moq) moqFields.push({ ...moq, sourceUrl: result.url });
      if (price) priceFields.push({ ...price, sourceUrl: result.url });
    }
    const location = explicitLocation(result);
    if (location) locationFields.push(location);
    const signal = deliverySignal(result, context.deliveryRegion);
    if (signal) deliverySignals.push({ ...signal, url: result.url });
  }

  const hasPositive = deliverySignals.some(signal => !signal.negative);
  const hasNegative = deliverySignals.some(signal => signal.negative);
  const decisive = hasPositive !== hasNegative ? deliverySignals.find(signal => signal.negative === hasNegative) : undefined;
  const status: DeliveryStatus = hasPositive && !hasNegative ? "confirmed"
    : hasNegative && !hasPositive ? "not_available" : "not_confirmed";
  return {
    product: oneValue(productFields)?.value ?? null,
    moq: oneValue(moqFields)?.value ?? null,
    price: oneValue(priceFields)?.value ?? null,
    supplierLocation: oneValue(locationFields)?.value ?? null,
    delivery: {
      region: context.deliveryRegion,
      status,
      evidence: decisive?.evidence ?? null,
      sourceUrl: decisive?.url ?? null,
      sourceType: decisive ? context.sourceType : null,
    },
  };
}

export function mergeEnrichment(primary: EnrichmentResult, secondary?: EnrichmentResult): EnrichmentResult {
  if (!secondary) return primary;
  const statuses = new Set([primary.delivery.status, secondary.delivery.status].filter(status => status !== "not_confirmed"));
  const delivery = statuses.size > 1
    ? { region: primary.delivery.region, status: "not_confirmed" as const, evidence: null, sourceUrl: null, sourceType: null }
    : primary.delivery.status !== "not_confirmed" ? primary.delivery : secondary.delivery;
  return {
    product: primary.product ?? secondary.product,
    moq: primary.moq ?? secondary.moq,
    price: primary.price ?? secondary.price,
    supplierLocation: primary.supplierLocation ?? secondary.supplierLocation,
    delivery,
  };
}

export async function enrichSupplier(
  supplier: { title: string; url: string; domain?: string | null; evidenceSources?: EnrichmentSearchResult[] },
  requestedProduct: string,
  deliveryRegion: string,
  search: EnrichmentSearch,
  diagnostics?: EnrichmentDiagnostics,
  requestedMaxMoq: string | null = null,
): Promise<EnrichmentResult> {
  const supplierHostname = canonicalSupplierDomain(supplier.domain ?? hostname(supplier.url));
  const empty = extractVerifiedEnrichment([], { supplierName: supplier.title, supplierHostname, deliveryRegion, sourceType: "official" });
  const discoveredSources = supplier.evidenceSources ?? [];
  const discoveredOfficial = extractVerifiedEnrichment(discoveredSources.filter(source => supplierHostname
    && canonicalSupplierDomain(source.url) === supplierHostname), {
    supplierName: supplier.title, supplierHostname, deliveryRegion, sourceType: "official",
  });
  const discoveredExternal = extractVerifiedEnrichment(discoveredSources.filter(source => !supplierHostname
    || canonicalSupplierDomain(source.url) !== supplierHostname), {
    supplierName: supplier.title, supplierHostname, deliveryRegion, sourceType: "external",
  });
  const discoveredEvidence = mergeEnrichment(discoveredOfficial, discoveredExternal);
  let official = empty;
  const moqRequirement = requestedMaxMoq ? `buyer maximum MOQ ${requestedMaxMoq}` : "";
  const officialQuery = `${requestedProduct} wholesale B2B catalog MOQ minimum order price ${moqRequirement} delivery shipping ${deliveryRegion} company legal address`.replace(/\s+/g, " ").trim();
  try {
    if (!supplierHostname) throw new Error("supplier official domain is unknown");
    const results = await search(
      officialQuery,
      { includeDomains: [supplierHostname], maxResults: 5 },
    );
    official = extractVerifiedEnrichment(results, { supplierName: supplier.title, supplierHostname, deliveryRegion, sourceType: "official" });
    diagnostics?.("official", {
      supplierTitle: supplier.title,
      hostname: supplierHostname,
      query: officialQuery,
      rawResults: results,
      evaluations: results.map(result => diagnosticEvaluation(result, { supplierName: supplier.title, supplierHostname, deliveryRegion, sourceType: "official" })),
      result: official,
      callFailed: false,
    });
  } catch {
    diagnostics?.("official", { supplierTitle: supplier.title, hostname: supplierHostname, query: officialQuery, rawResults: [], evaluations: [], result: official, callFailed: true });
  }

  const collected = mergeEnrichment(discoveredEvidence, official);
  if (collected.delivery.status !== "not_confirmed") return collected;
  const externalQuery = `"${supplier.title}" "${supplierHostname}" ${requestedProduct} ${moqRequirement} ${deliveryRegion} shipping delivery wholesale distributor`.replace(/\s+/g, " ").trim();
  try {
    const externalResults = await search(
      externalQuery,
      { maxResults: 5 },
    );
    const external = extractVerifiedEnrichment(externalResults, { supplierName: supplier.title, supplierHostname, deliveryRegion, sourceType: "external" });
    diagnostics?.("external", {
      supplierTitle: supplier.title,
      hostname: supplierHostname,
      query: externalQuery,
      rawResults: externalResults,
      evaluations: externalResults.map(result => diagnosticEvaluation(result, { supplierName: supplier.title, supplierHostname, deliveryRegion, sourceType: "external" })),
      result: external,
      callFailed: false,
    });
    return mergeEnrichment(collected, external);
  } catch {
    diagnostics?.("external", { supplierTitle: supplier.title, hostname: supplierHostname, query: externalQuery, rawResults: [], evaluations: [], result: empty, callFailed: true });
    return collected;
  }
}

export function rankAndFilterByDelivery<T extends { delivery: DeliveryVerification; score: number }>(results: T[]): T[] {
  return results
    .filter(result => result.delivery.status === "confirmed")
    .sort((a, b) => b.score - a.score);
}
