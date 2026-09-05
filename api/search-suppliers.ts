import { extractProduct, extractSupplierFields } from "./supplier-extraction";
import { qualifySupplierCandidate } from "./supplier-qualification";
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
import {
  buildAdditionalMarketAwareDiscoveryQuery,
  buildComplementaryMarketAwareDiscoveryQuery,
  buildMarketAwareDiscoveryQuery,
} from "./market-discovery";
import { identifySupplier, supplierIdentityKey, type SupplierIdentity } from "./supplier-identity";

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

function diagnosticsLog(prefix: "PRIMARY" | "ADDITIONAL" | "COMPLEMENTARY" | "OFFICIAL" | "EXTERNAL" | "FINAL" | "SUMMARY", payload: unknown): void {
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
  const searchQuery = buildMarketAwareDiscoveryQuery(criteria.product ?? normalizedQuery, normalizedDeliveryRegion);

  let primaryResults: TavilyResult[];
  try {
    primaryResults = await tavilySearch(apiKey, searchQuery, { maxResults: 10 });
  } catch {
    response.status(502).json({
      error: "Supplier search service is currently unavailable.",
    });
    return;
  }

  type CandidateGroup = {
    identity: SupplierIdentity;
    primary: TavilyResult;
    fields: ReturnType<typeof extractSupplierFields>;
    evidenceSources: TavilyResult[];
  };
  const diagnosticsEnabled = process.env.SUPPLIER_SEARCH_DIAGNOSTICS === "true";
  const requestId = diagnosticsEnabled
    ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    : null;
  type DiagnosticResult = {
    index: number;
    title: string;
    url: string;
    hostname: string;
    accepted: boolean;
    reason: string | null;
    extractedProduct: string | null;
    productRelevant: boolean;
    supplierName?: string | null;
    supplierDomain?: string | null;
    sourceType?: string | null;
    marketplaceDomain?: string | null;
    marketplaceSeller?: string | null;
    productEvidence?: string | null;
    b2bEvidence?: string[];
  };
  function evaluateDiscovery(results: TavilyResult[]) {
    const candidateGroups = new Map<string, CandidateGroup>();
    const evaluations: DiagnosticResult[] = [];
    const productRelevantCandidates: Array<{ title: string; url: string; hostname: string }> = [];
    let qualifiedCount = 0;
    let productRelevantCount = 0;
    for (const [resultIndex, { title, url, content, score }] of results.entries()) {
      const identity = identifySupplier(title, content, url);
      const qualification = qualifySupplierCandidate(title, content, url);
      const fields = extractSupplierFields(title, content, url);
      const productRelevant = Boolean(identity && qualification.qualified && fields.product && requestedProduct
        && fields.product.value === requestedProduct.value);
      evaluations.push({
        index: resultIndex, title, url, hostname: hostnameKey(url), accepted: qualification.qualified,
        reason: qualification.qualified ? null : qualification.reason,
        extractedProduct: fields.product?.value ?? null, productRelevant,
        supplierName: identity?.name ?? null, supplierDomain: identity?.domain ?? null,
        sourceType: identity?.sourceType ?? null,
        marketplaceDomain: identity?.sourceType === "marketplace" ? hostnameKey(url) : null,
        marketplaceSeller: identity?.sourceType === "marketplace" ? identity.name : null,
        productEvidence: fields.product?.evidence ?? null,
        b2bEvidence: qualification.qualified ? qualification.evidence : [],
      });
      if (!identity || !qualification.qualified) continue;
      qualifiedCount += 1;
      if (!fields.product || !requestedProduct || fields.product.value !== requestedProduct.value) continue;
      productRelevantCount += 1;
      const hostname = identity.domain ?? hostnameKey(url);
      productRelevantCandidates.push({ title: identity.name, url, hostname });
      const key = supplierIdentityKey(identity);
      const current = candidateGroups.get(key);
      if (current) {
        current.evidenceSources.push({ title, url, content, score });
        if (score > current.primary.score) current.primary = { title, url, content, score };
        // An official identity supersedes a title inferred from non-official evidence.
        if (identity.sourceType === "official" && current.identity.sourceType !== "official") current.identity = identity;
      } else {
        candidateGroups.set(key, { identity, primary: { title, url, content, score }, fields, evidenceSources: [{ title, url, content, score }] });
      }
    }
    return { candidateGroups, evaluations, productRelevantCandidates, qualifiedCount, productRelevantCount };
  }

  const discoveryExpansionTarget = 8;
  const primaryEvaluation = evaluateDiscovery(primaryResults);
  const additionalTriggered = primaryEvaluation.candidateGroups.size < discoveryExpansionTarget;
  const additionalTriggerReason = additionalTriggered
    ? `viable unique suppliers ${primaryEvaluation.candidateGroups.size} is below target ${discoveryExpansionTarget}`
    : `viable unique suppliers ${primaryEvaluation.candidateGroups.size} reached target ${discoveryExpansionTarget}`;
  const additionalQuery = additionalTriggered
    ? buildAdditionalMarketAwareDiscoveryQuery(criteria.product ?? normalizedQuery, normalizedDeliveryRegion)
    : null;
  let additionalResults: TavilyResult[] = [];
  if (additionalQuery) {
    try {
      additionalResults = await tavilySearch(apiKey, additionalQuery, { maxResults: 10 });
    } catch {
      // The bounded supplemental attempt is best-effort; primary discovery remains usable.
      additionalResults = [];
    }
  }
  const primaryAndAdditionalResults = [...primaryResults, ...additionalResults];
  const primaryAndAdditionalEvaluation = evaluateDiscovery(primaryAndAdditionalResults);
  const complementaryTriggered = primaryAndAdditionalEvaluation.candidateGroups.size < discoveryExpansionTarget;
  const complementaryTriggerReason = complementaryTriggered
    ? `viable unique suppliers ${primaryAndAdditionalEvaluation.candidateGroups.size} is below target ${discoveryExpansionTarget}`
    : `viable unique suppliers ${primaryAndAdditionalEvaluation.candidateGroups.size} reached target ${discoveryExpansionTarget}`;
  const complementaryQuery = complementaryTriggered
    ? buildComplementaryMarketAwareDiscoveryQuery(criteria.product ?? normalizedQuery, normalizedDeliveryRegion)
    : null;
  let complementaryResults: TavilyResult[] = [];
  if (complementaryQuery) {
    try {
      complementaryResults = await tavilySearch(apiKey, complementaryQuery, { maxResults: 10 });
    } catch {
      // The final bounded discovery attempt is best-effort; earlier discovery remains usable.
      complementaryResults = [];
    }
  }
  const tavilyResults = [...primaryAndAdditionalResults, ...complementaryResults];
  // Re-run the complete pipeline over all discovery evidence after each bounded expansion decision.
  const combinedEvaluation = evaluateDiscovery(tavilyResults);
  const candidates = [...combinedEvaluation.candidateGroups.values()];

  if (diagnosticsEnabled) {
    diagnosticsLog("PRIMARY", {
      requestId,
      normalizedQuery,
      criteria,
      deliveryRegion: normalizedDeliveryRegion,
      tavilyQuery: searchQuery,
      exactQuery: searchQuery,
      rawResults: primaryResults.map((result, index) => diagnosticRawResult(result, index)),
      evaluations: primaryEvaluation.evaluations,
      afterQualificationAndProductRelevance: primaryEvaluation.productRelevantCandidates,
      afterSupplierIdentityDedupe: [...primaryEvaluation.candidateGroups.values()].map(candidate => ({ title: candidate.identity.name, url: candidate.identity.officialUrl, domain: candidate.identity.domain, evidenceCount: candidate.evidenceSources.length })),
    });
    diagnosticsLog("ADDITIONAL", {
      requestId,
      exactQuery: additionalQuery,
      triggerReason: additionalTriggerReason,
      triggered: additionalTriggered,
      rawResults: additionalResults.map((result, index) => diagnosticRawResult(result, index)),
      combinedRawCount: primaryAndAdditionalResults.length,
      evaluations: primaryAndAdditionalEvaluation.evaluations,
      afterQualificationAndProductRelevance: primaryAndAdditionalEvaluation.productRelevantCandidates,
      afterSupplierIdentityDedupe: [...primaryAndAdditionalEvaluation.candidateGroups.values()].map(candidate => ({ title: candidate.identity.name, url: candidate.identity.officialUrl, domain: candidate.identity.domain, evidenceCount: candidate.evidenceSources.length })),
    });
    diagnosticsLog("COMPLEMENTARY", {
      requestId,
      exactQuery: complementaryQuery,
      triggered: complementaryTriggered,
      triggerReason: complementaryTriggerReason,
      rawResults: complementaryResults.map((result, index) => diagnosticRawResult(result, index)),
      combinedRawCount: tavilyResults.length,
      evaluations: combinedEvaluation.evaluations,
      afterQualificationAndProductRelevance: combinedEvaluation.productRelevantCandidates,
      afterSupplierIdentityDedupe: candidates.map(candidate => ({ title: candidate.identity.name, url: candidate.identity.officialUrl, domain: candidate.identity.domain, evidenceCount: candidate.evidenceSources.length })),
    });
  }

  let officialCalls = 0;
  let externalCalls = 0;
  const finalDiagnostics: Array<{ supplierTitle: string; supplierUrl: string; primary: unknown; official: unknown; external: unknown; final: unknown }> = [];
  const enriched = await Promise.all(candidates.map(async candidate => {
    const primary = {
      product: candidate.fields.product?.value ?? null,
      moq: null,
      price: null,
      // Medium country extraction may combine a city mention with a TLD; that is not reliable location evidence.
      supplierLocation: candidate.fields.country?.confidence === "high" ? candidate.fields.country.value : null,
      delivery: { region: normalizedDeliveryRegion, status: "not_confirmed" as const, evidence: null, sourceUrl: null, sourceType: null },
    };
    const diagnosticTrace = {
      supplierTitle: candidate.identity.name,
      supplierUrl: candidate.identity.officialUrl ?? candidate.primary.url,
      primary,
      official: null as unknown,
      external: null as unknown,
      final: null as unknown,
    };
    if (diagnosticsEnabled) finalDiagnostics.push(diagnosticTrace);
    const verification = await enrichSupplier(
      { title: candidate.identity.name, url: candidate.identity.officialUrl ?? candidate.primary.url, domain: candidate.identity.domain, evidenceSources: candidate.evidenceSources },
      requestedProduct.value,
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
      url: candidate.identity.officialUrl ?? candidate.primary.url,
      content: candidate.primary.content,
      score: candidate.primary.score,
      supplierDomain: candidate.identity.domain,
      evidenceSources: candidate.evidenceSources.map(source => ({ url: source.url, sourceType: identifySupplier(source.title, source.content, source.url)?.sourceType ?? "external" })),
      product: fields.product,
      country: fields.supplierLocation,
      supplierLocation: fields.supplierLocation,
      moq: fields.moq,
      price: fields.price,
      delivery: fields.delivery,
    } satisfies SupplierSearchResult;
  }));
  const results = rankAndFilterByDelivery(enriched);

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
        finalExclusionReason: candidate.product !== requestedProduct.value
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
      additionalTriggered,
      complementaryQuery,
      complementaryTriggerReason,
      complementaryTriggered,
      primaryRawCount: primaryResults.length,
      additionalRawCount: additionalResults.length,
      complementaryRawCount: complementaryResults.length,
      combinedRawCount: tavilyResults.length,
      qualifiedCount: combinedEvaluation.qualifiedCount,
      productRelevantCount: combinedEvaluation.productRelevantCount,
      dedupedCount: candidates.length,
      discoveryCallCount: 1 + Number(additionalTriggered) + Number(complementaryTriggered),
      officialCalls,
      externalCalls,
      confirmedDeliveryCount: enriched.filter(item => item.delivery.status === "confirmed").length,
      notConfirmedDeliveryCount: enriched.filter(item => item.delivery.status === "not_confirmed").length,
      notAvailableDeliveryCount: enriched.filter(item => item.delivery.status === "not_available").length,
      returnedCount: results.length,
    });
  }

  response.status(200).json({
    query: normalizedQuery,
    deliveryRegion: normalizedDeliveryRegion,
    results,
  });
}
