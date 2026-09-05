import { extractProduct } from "./supplier-extraction";
import {
  enrichSupplier,
  mergeEnrichment,
  rankAndFilterByDelivery,
  type DeliveryVerification,
  type EnrichmentSearchResult,
} from "./supplier-enrichment";
import {
  deriveSupplierSearchCriteria,
  type SupplierSearchCriteria,
} from "../shared/supplier-search-criteria";
import { buildAdditionalMarketAwareDiscoveryQuery, buildComplementaryMarketAwareDiscoveryQuery, buildMarketAwareDiscoveryQuery } from "./market-discovery";
import { asDiscoveryEvidence, evidenceProduct, resolveSupplierIdentities } from "./supplier-discovery";

declare const process: {
  env: {
    TAVILY_API_KEY?: string;
    SUPPLIER_SEARCH_DIAGNOSTICS?: string;
    VERCEL_ENV?: string;
  };
};

interface SearchSuppliersBody {
  query?: unknown;
  deliveryRegion?: unknown;
  criteria?: unknown;
}

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(statusCode: number): VercelResponse;
  setHeader(name: string, value: string): VercelResponse;
  json(body: unknown): void;
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface SupplierSearchResult extends TavilyResult {
  product: string | null;
  country: string | null;
  supplierLocation: string | null;
  moq: string | null;
  price: string | null;
  delivery: DeliveryVerification;
}

const DISCOVERY_EXPANSION_TARGET = 8;
const DISCOVERY_MAX_RESULTS = 10;

function hostnameKey(url: string): string {
  try {
    return new URL(url).hostname.toLocaleLowerCase().replace(/^www\./, "");
  } catch {
    return url.trim().toLocaleLowerCase();
  }
}

function diagnosticRawResult(result: TavilyResult, index?: number) {
  return {
    ...(index === undefined ? {} : { index }),
    title: result.title,
    url: result.url,
    hostname: hostnameKey(result.url),
    snippet: result.content.slice(0, 1200),
    score: result.score,
  };
}

function diagnosticResolution(resolution: ReturnType<typeof resolveSupplierIdentities>["resolutions"][number]) {
  return {
    evidence: diagnosticRawResult(resolution.evidence),
    identityResolved: resolution.identityResolved,
    identityRejectedReason: resolution.identityRejectedReason,
    canonicalSupplierName: resolution.identity?.name ?? null,
    canonicalSupplierDomain: resolution.identity?.domain ?? null,
    identitySource: resolution.identity?.identitySource ?? null,
    b2bQualified: resolution.b2bQualified,
    b2bEvidence: resolution.b2bEvidence,
  };
}

function diagnosticsLog(prefix: "PRIMARY" | "ADDITIONAL" | "OFFICIAL" | "EXTERNAL" | "FINAL" | "SUMMARY", payload: unknown): void {
  console.log(`[SUPPLIER_DIAGNOSTICS][${prefix}]`, JSON.stringify(payload));
}

function structuredCriteriaFromBody(
  query: string,
  deliveryRegion: string,
  value: unknown,
): SupplierSearchCriteria {
  const fallback = deriveSupplierSearchCriteria(query, deliveryRegion);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fallback;
  const candidate = value as Record<string, unknown>;
  const product = typeof candidate.product === "string" || candidate.product === null
    ? candidate.product
    : fallback.product;
  const region = typeof candidate.deliveryRegion === "string" && candidate.deliveryRegion.trim()
    ? candidate.deliveryRegion.trim()
    : fallback.deliveryRegion;
  let maxMoq = fallback.maxMoq;
  if (candidate.maxMoq === null) maxMoq = null;
  else if (candidate.maxMoq && typeof candidate.maxMoq === "object" && !Array.isArray(candidate.maxMoq)) {
    const quantity = candidate.maxMoq as Record<string, unknown>;
    if (typeof quantity.value === "number" && Number.isFinite(quantity.value) && quantity.value > 0
      && (quantity.unit === "кг" || quantity.unit === "шт" || quantity.unit === "т")) {
      maxMoq = { value: quantity.value, unit: quantity.unit, displayValue: `до ${quantity.value} ${quantity.unit}` };
    }
  }
  return { product, deliveryRegion: region, maxMoq };
}

function isTavilyResult(value: unknown): value is TavilyResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const result = value as Record<string, unknown>;

  return (
    typeof result.title === "string" &&
    typeof result.url === "string" &&
    typeof result.content === "string" &&
    typeof result.score === "number" &&
    Number.isFinite(result.score)
  );
}

async function tavilySearch(
  apiKey: string,
  searchQuery: string,
  options: { includeDomains?: string[]; maxResults: number },
): Promise<EnrichmentSearchResult[]> {
  const tavilyResponse = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: searchQuery,
      search_depth: "basic",
      topic: "general",
      max_results: options.maxResults,
      include_domains: options.includeDomains,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
  });
  if (!tavilyResponse.ok) throw new Error("Tavily returned an error");
  const data: unknown = await tavilyResponse.json();
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid Tavily response");
  const results = (data as Record<string, unknown>).results;
  if (!Array.isArray(results) || !results.every(isTavilyResult)) throw new Error("Invalid Tavily results");
  return results;
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  let body = request.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body) as unknown;
    } catch {
      response.status(400).json({ error: "Request body must be valid JSON." });
      return;
    }
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    response.status(400).json({ error: "Request body must be a JSON object." });
    return;
  }

  const { query, deliveryRegion, criteria: requestCriteria } = body as SearchSuppliersBody;

  if (typeof query !== "string" || query.trim().length === 0) {
    response.status(400).json({ error: 'The "query" field must be a non-empty string.' });
    return;
  }

  if (typeof deliveryRegion !== "string") {
    response.status(400).json({ error: 'The "deliveryRegion" field must be a string.' });
    return;
  }

  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    response.status(500).json({
      error: "Server configuration error: TAVILY_API_KEY is not set.",
    });
    return;
  }

  const normalizedQuery = query.trim();
  const criteria = structuredCriteriaFromBody(normalizedQuery, deliveryRegion.trim(), requestCriteria);
  const normalizedDeliveryRegion = criteria.deliveryRegion;
  const requestedProduct = extractProduct(criteria.product ?? normalizedQuery, "", "");
  const requestedProductValue = requestedProduct?.value ?? criteria.product;
  if (!requestedProductValue) {
    response.status(200).json({ query: normalizedQuery, deliveryRegion: normalizedDeliveryRegion, results: [] });
    return;
  }
  const searchQuery = buildMarketAwareDiscoveryQuery(criteria.product ?? normalizedQuery, normalizedDeliveryRegion);

  let primaryResults: TavilyResult[];
  try {
    primaryResults = await tavilySearch(apiKey, searchQuery, { maxResults: DISCOVERY_MAX_RESULTS });
  } catch {
    response.status(502).json({
      error: "Supplier search service is currently unavailable.",
    });
    return;
  }

  const diagnosticsEnabled = process.env.SUPPLIER_SEARCH_DIAGNOSTICS === "true" && process.env.VERCEL_ENV !== "production";
  const requestId = diagnosticsEnabled
    ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    : null;
  const primaryEvidence = asDiscoveryEvidence(primaryResults, "primary");
  const primaryEvaluation = resolveSupplierIdentities(primaryEvidence);
  const additionalTriggered = primaryEvaluation.suppliers.length < DISCOVERY_EXPANSION_TARGET;
  const additionalTriggerReason = additionalTriggered
    ? `resolved unique suppliers ${primaryEvaluation.suppliers.length} is below ${DISCOVERY_EXPANSION_TARGET}`
    : null;
  const additionalQuery = additionalTriggered
    ? buildAdditionalMarketAwareDiscoveryQuery(criteria.product ?? normalizedQuery, normalizedDeliveryRegion)
    : null;
  let additionalResults: TavilyResult[] = [];
  if (additionalQuery) {
    try {
      additionalResults = await tavilySearch(apiKey, additionalQuery, { maxResults: DISCOVERY_MAX_RESULTS });
    } catch {
      // The bounded supplemental attempt is best-effort; primary discovery remains usable.
      additionalResults = [];
    }
  }
  const firstTwoEvidence = [...primaryEvidence, ...asDiscoveryEvidence(additionalResults, "commercial")];
  const firstTwoEvaluation = resolveSupplierIdentities(firstTwoEvidence);
  const complementaryTriggered = firstTwoEvaluation.suppliers.length < DISCOVERY_EXPANSION_TARGET;
  const complementaryQuery = complementaryTriggered
    ? buildComplementaryMarketAwareDiscoveryQuery(criteria.product ?? normalizedQuery, normalizedDeliveryRegion) : null;
  let complementaryResults: TavilyResult[] = [];
  if (complementaryQuery) {
    try { complementaryResults = await tavilySearch(apiKey, complementaryQuery, { maxResults: DISCOVERY_MAX_RESULTS }); }
    catch { complementaryResults = []; }
  }
  const discoveryEvidence = [...firstTwoEvidence, ...asDiscoveryEvidence(complementaryResults, "complementary")];
  const combinedEvaluation = resolveSupplierIdentities(discoveryEvidence);
  const candidates = combinedEvaluation.suppliers;

  if (diagnosticsEnabled) {
    diagnosticsLog("PRIMARY", {
      requestId,
      normalizedQuery,
      criteria,
      deliveryRegion: normalizedDeliveryRegion,
      tavilyQuery: searchQuery,
      exactQuery: searchQuery,
      rawResults: primaryResults.map((result, index) => diagnosticRawResult(result, index)),
      identityResolutions: primaryEvaluation.resolutions.map(diagnosticResolution),
      deduplicatedSuppliers: primaryEvaluation.suppliers.map(candidate => ({ canonicalSupplierName: candidate.identity.name, canonicalSupplierDomain: candidate.identity.domain, evidenceCount: candidate.evidence.length })),
    });
    diagnosticsLog("ADDITIONAL", {
      requestId,
      exactQuery: additionalQuery,
      triggerReason: additionalTriggerReason,
      rawResults: additionalResults.map((result, index) => diagnosticRawResult(result, index)),
      complementaryQuery,
      complementaryRawResults: complementaryResults.map((result, index) => diagnosticRawResult(result, index)),
      combinedRawCount: discoveryEvidence.length,
      identityResolutions: combinedEvaluation.resolutions.map(diagnosticResolution),
      deduplicatedSuppliers: candidates.map(candidate => ({ canonicalSupplierName: candidate.identity.name, canonicalSupplierDomain: candidate.identity.domain, aliases: candidate.identity.aliases, identitySource: candidate.identity.identitySource, evidenceCount: candidate.evidence.length })),
    });
  }

  let officialCalls = 0;
  let externalCalls = 0;
  const finalDiagnostics: Array<{ supplierTitle: string; supplierUrl: string; primary: unknown; official: unknown; external: unknown; final: unknown }> = [];
  const enriched = await Promise.all(candidates.map(async candidate => {
    const primary = {
      product: evidenceProduct(candidate.evidence, requestedProductValue),
      moq: null,
      price: null,
      supplierLocation: null,
      delivery: { region: normalizedDeliveryRegion, status: "not_confirmed" as const, evidence: null, sourceUrl: null, sourceType: null },
    };
    const diagnosticTrace = {
      supplierTitle: candidate.identity.name,
      supplierUrl: candidate.identity.officialUrl ?? candidate.primaryEvidence.url,
      primary,
      official: null as unknown,
      external: null as unknown,
      final: null as unknown,
    };
    if (diagnosticsEnabled) finalDiagnostics.push(diagnosticTrace);
    const verification = await enrichSupplier(
      { title: candidate.identity.name, url: candidate.identity.officialUrl ?? candidate.primaryEvidence.url, domain: candidate.identity.domain, evidenceSources: candidate.evidence },
      requestedProductValue,
      normalizedDeliveryRegion,
      (enrichmentQuery, options) => tavilySearch(apiKey, enrichmentQuery, options),
      diagnosticsEnabled ? (stage, payload) => {
        if (stage === "official") officialCalls += 1;
        else externalCalls += 1;
        const rawResults = (payload.rawResults as TavilyResult[]).map(result => diagnosticRawResult(result));
        const evaluations = payload.evaluations as Array<Record<string, unknown>>;
        const loggedPayload = {
          requestId,
          ...payload,
          rawResults,
          productCandidates: evaluations.map(item => item.productCandidate).filter(Boolean),
          moqCandidates: evaluations.map(item => item.moqCandidate).filter(Boolean),
          priceCandidates: evaluations.map(item => item.priceCandidate).filter(Boolean),
          supplierLocationCandidates: evaluations.map(item => item.supplierLocationCandidate).filter(Boolean),
          deliveryEvidenceCandidates: evaluations.map(item => item.deliveryEvidenceCandidate).filter(Boolean),
        };
        diagnosticsLog(stage === "official" ? "OFFICIAL" : "EXTERNAL", loggedPayload);
        diagnosticTrace[stage] = payload.result;
      } : undefined,
      criteria.maxMoq?.displayValue ?? null,
    );
    const fields = mergeEnrichment(primary, verification);
    if (diagnosticsEnabled) diagnosticTrace.final = fields;
    return {
      title: candidate.identity.name,
      url: candidate.identity.officialUrl ?? candidate.primaryEvidence.url,
      content: candidate.primaryEvidence.content,
      score: candidate.primaryEvidence.score,
      supplierDomain: candidate.identity.domain,
      evidenceSources: candidate.evidence.map(source => ({ url: source.url, sourceType: source.sourceType })),
      product: fields.product,
      country: fields.supplierLocation,
      supplierLocation: fields.supplierLocation,
      moq: fields.moq,
      price: fields.price,
      delivery: fields.delivery,
    } satisfies SupplierSearchResult;
  }));
  const results = rankAndFilterByDelivery(enriched).filter(result => result.product === requestedProductValue);

  if (diagnosticsEnabled) {
    for (const [candidateIndex, candidate] of enriched.entries()) {
      const trace = finalDiagnostics.find(item => item.supplierUrl === candidate.url);
      const rankingIndex = results.findIndex(result => result.url === candidate.url);
      diagnosticsLog("FINAL", {
        requestId,
        supplierTitle: candidate.title,
        primaryValues: trace?.primary ?? null,
        officialValues: trace?.official ?? null,
        externalValues: trace?.external ?? null,
        finalMergedValues: trace?.final ?? candidate,
        excludedBecauseDeliveryNotConfirmed: candidate.delivery.status !== "confirmed",
        finalExclusionReason: candidate.product !== requestedProductValue
          ? "requested product not confirmed"
          : candidate.delivery.status !== "confirmed"
            ? `delivery to ${normalizedDeliveryRegion} ${candidate.delivery.status.replace("_", " ")}`
            : null,
        finalRankingPosition: rankingIndex < 0 ? null : rankingIndex + 1,
        preFilterPosition: candidateIndex + 1,
      });
    }
    diagnosticsLog("SUMMARY", {
      requestId,
      primaryQuery: searchQuery,
      additionalQuery,
      additionalTriggerReason,
      primaryRawCount: primaryResults.length,
      additionalRawCount: additionalResults.length,
      complementaryRawCount: complementaryResults.length,
      discoveryCallCount: 1 + Number(Boolean(additionalQuery)) + Number(Boolean(complementaryQuery)),
      combinedRawCount: discoveryEvidence.length,
      identityResolvedCount: combinedEvaluation.resolutions.filter(item => item.identityResolved).length,
      identityRejectedCount: combinedEvaluation.resolutions.filter(item => !item.identityResolved).length,
      dedupedCount: candidates.length,
      officialCalls,
      externalCalls,
      confirmedDeliveryCount: enriched.filter(item => item.delivery.status === "confirmed").length,
      notConfirmedDeliveryCount: enriched.filter(item => item.delivery.status === "not_confirmed").length,
      notAvailableCount: enriched.filter(item => item.delivery.status === "not_available").length,
      returnedCount: results.length,
    });
  }

  response.status(200).json({
    query: normalizedQuery,
    deliveryRegion: normalizedDeliveryRegion,
    results,
  });
}
