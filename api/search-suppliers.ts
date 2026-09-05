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

function diagnosticsLog(prefix: "PRIMARY" | "OFFICIAL" | "EXTERNAL" | "FINAL" | "SUMMARY", payload: unknown): void {
  console.log(`[SUPPLIER_DIAGNOSTICS][${prefix}]`, JSON.stringify(payload));
}

const PRIMARY_DISCOVERY_MAX_RESULTS = 20;
const FALLBACK_DISCOVERY_MAX_RESULTS = 10;
const MIN_VIABLE_PRIMARY_DOMAINS = 1;

function primaryDiscoveryQuery(product: string): string {
  return `${product} wholesale supplier manufacturer distributor B2B`;
}

function fallbackDiscoveryQuery(product: string): string {
  return `${product} wholesale catalog bulk trade distributor manufacturer`;
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
  const discoveryProduct = criteria.product ?? normalizedQuery;
  const searchQuery = primaryDiscoveryQuery(discoveryProduct);

  let primaryResults: TavilyResult[];
  try {
    primaryResults = await tavilySearch(apiKey, searchQuery, { maxResults: PRIMARY_DISCOVERY_MAX_RESULTS });
  } catch {
    response.status(502).json({
      error: "Supplier search service is currently unavailable.",
    });
    return;
  }

  const seenHostnames = new Set<string>();
  const candidates: Array<TavilyResult & { fields: ReturnType<typeof extractSupplierFields> }> = [];
  const diagnosticsEnabled = process.env.SUPPLIER_SEARCH_DIAGNOSTICS === "true";
  const requestId = diagnosticsEnabled
    ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    : null;
  const diagnosticResults: Array<{
    index: number;
    discoveryStage: "primary" | "fallback";
    title: string;
    url: string;
    hostname: string;
    accepted: boolean;
    reason: string | null;
    extractedProduct: string | null;
    productRelevant: boolean;
  }> = [];
  let qualifiedResultCount = 0;
  let productRelevantCount = 0;
  const productRelevantCandidates: Array<{ title: string; url: string; hostname: string }> = [];

  const evaluateResults = (results: TavilyResult[], discoveryStage: "primary" | "fallback") => {
    for (const [resultIndex, { title, url, content, score }] of results.entries()) {
      const qualification = qualifySupplierCandidate(title, content, url);

      const fields = extractSupplierFields(title, content, url);
      const productRelevant = Boolean(
        qualification.qualified
        && fields.product
        && requestedProduct
        && fields.product.value === requestedProduct.value,
      );
      if (diagnosticsEnabled) {
        diagnosticResults.push({
          index: resultIndex,
          discoveryStage,
          title,
          url,
          hostname: hostnameKey(url),
          accepted: qualification.qualified,
          reason: qualification.qualified ? null : qualification.reason,
          extractedProduct: fields.product?.value ?? null,
          productRelevant,
        });
      }

      if (!qualification.qualified) continue;
      qualifiedResultCount += 1;
      // Supplier identity alone is insufficient: the primary evidence must also name the requested product.
      if (!fields.product || !requestedProduct || fields.product.value !== requestedProduct.value) continue;
      productRelevantCount += 1;

      const hostname = hostnameKey(url);
      productRelevantCandidates.push({ title, url, hostname });
      if (seenHostnames.has(hostname)) continue;

      seenHostnames.add(hostname);
      candidates.push({ title, url, content, score, fields });
    }
  };

  evaluateResults(primaryResults, "primary");

  let fallbackResults: TavilyResult[] = [];
  let fallbackQuery: string | null = null;
  if (candidates.length < MIN_VIABLE_PRIMARY_DOMAINS) {
    fallbackQuery = fallbackDiscoveryQuery(discoveryProduct);
    try {
      fallbackResults = await tavilySearch(apiKey, fallbackQuery, { maxResults: FALLBACK_DISCOVERY_MAX_RESULTS });
      evaluateResults(fallbackResults, "fallback");
    } catch {
      // Primary discovery succeeded, so a best-effort fallback failure must not fail the request.
    }
  }

  const tavilyResults = [...primaryResults, ...fallbackResults];

  if (diagnosticsEnabled) {
    diagnosticsLog("PRIMARY", {
      requestId,
      normalizedQuery,
      criteria,
      deliveryRegion: normalizedDeliveryRegion,
      primaryQuery: searchQuery,
      fallbackQuery,
      primaryRawResults: primaryResults.map((result, index) => diagnosticRawResult(result, index)),
      fallbackRawResults: fallbackResults.map((result, index) => diagnosticRawResult(result, index)),
      combinedRawResults: tavilyResults.map((result, index) => diagnosticRawResult(result, index)),
      evaluations: diagnosticResults,
      afterQualificationAndProductRelevance: productRelevantCandidates,
      afterHostnameDedupe: candidates.map(candidate => ({ title: candidate.title, url: candidate.url, hostname: hostnameKey(candidate.url) })),
    });
  }

  let officialCalls = 0;
  let externalCalls = 0;
  const finalDiagnostics: Array<{ supplierTitle: string; supplierUrl: string; primary: unknown; official: unknown; external: unknown; final: unknown }> = [];
  const enriched = await Promise.all(candidates.map(async candidate => {
    const primary = {
      product: candidate.fields.product?.value ?? null,
      moq: candidate.fields.moq?.value ?? null,
      price: candidate.fields.price?.value ?? null,
      // Medium country extraction may combine a city mention with a TLD; that is not reliable location evidence.
      supplierLocation: candidate.fields.country?.confidence === "high" ? candidate.fields.country.value : null,
      delivery: { region: normalizedDeliveryRegion, status: "not_confirmed" as const, evidence: null, sourceUrl: null, sourceType: null },
    };
    const diagnosticTrace = {
      supplierTitle: candidate.title,
      supplierUrl: candidate.url,
      primary,
      official: null as unknown,
      external: null as unknown,
      final: null as unknown,
    };
    if (diagnosticsEnabled) finalDiagnostics.push(diagnosticTrace);
    const verification = await enrichSupplier(
      { title: candidate.title, url: candidate.url },
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
      title: candidate.title,
      url: candidate.url,
      content: candidate.content,
      score: candidate.score,
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
        finalRankingPosition: rankingIndex < 0 ? null : rankingIndex + 1,
        preFilterPosition: candidateIndex + 1,
      });
    }
    diagnosticsLog("SUMMARY", {
      requestId,
      primaryQuery: searchQuery,
      fallbackQuery,
      primaryRawCount: primaryResults.length,
      fallbackRawCount: fallbackResults.length,
      combinedRawCount: tavilyResults.length,
      qualifiedCount: qualifiedResultCount,
      productRelevantCount,
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
