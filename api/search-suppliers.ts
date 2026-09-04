import { extractProduct, extractSupplierFields } from "./supplier-extraction";
import { qualifySupplierCandidate } from "./supplier-qualification";
import {
  enrichSupplier,
  mergeEnrichment,
  rankAndFilterByDelivery,
  type DeliveryVerification,
  type EnrichmentSearchResult,
} from "./supplier-enrichment";

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

  const { query, deliveryRegion } = body as SearchSuppliersBody;

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
  const normalizedDeliveryRegion = deliveryRegion.trim();
  const requestedProduct = extractProduct(normalizedQuery, "", "");
  const searchQuery = [
    normalizedQuery,
    normalizedDeliveryRegion && `delivery region: ${normalizedDeliveryRegion}`,
    "Find actual suppliers, manufacturers, distributors, or wholesalers that sell or distribute the requested product.",
    "Prioritize official supplier or manufacturer websites, product catalog pages, and wholesale or B2B supplier pages.",
    "Exclude blog posts, news articles, guides, educational content, how to choose a supplier articles, and general informational pages.",
  ]
    .filter(Boolean)
    .join(" ");

  let tavilyResults: TavilyResult[];
  try {
    tavilyResults = await tavilySearch(apiKey, searchQuery, { maxResults: 5 });
  } catch {
    response.status(502).json({
      error: "Supplier search service is currently unavailable.",
    });
    return;
  }

  const seenHostnames = new Set<string>();
  const candidates: Array<TavilyResult & { fields: ReturnType<typeof extractSupplierFields> }> = [];
  const diagnosticsEnabled =
    process.env.VERCEL_ENV === "preview" &&
    process.env.SUPPLIER_SEARCH_DIAGNOSTICS === "true";
  const requestId = diagnosticsEnabled
    ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    : null;
  const diagnosticResults: Array<{
    resultIndex: number;
    title: string;
    url: string;
    qualified: boolean;
    reason: string | null;
    confidence: "high" | "medium" | null;
    evidence: string[];
  }> = [];
  let qualifiedResultCount = 0;

  for (const [resultIndex, { title, url, content, score }] of tavilyResults.entries()) {
    const qualification = qualifySupplierCandidate(title, content, url);

    if (diagnosticsEnabled) {
      if ("reason" in qualification) {
        diagnosticResults.push({
          resultIndex,
          title,
          url,
          qualified: false,
          reason: qualification.reason,
          confidence: null,
          evidence: [],
        });
      } else {
        diagnosticResults.push({
          resultIndex,
          title,
          url,
          qualified: true,
          reason: null,
          confidence: qualification.confidence,
          evidence: qualification.evidence,
        });
      }
    }

    if (!qualification.qualified) continue;
    qualifiedResultCount += 1;

    const fields = extractSupplierFields(title, content, url);
    // Supplier identity alone is insufficient: the primary evidence must also name the requested product.
    if (!fields.product || !requestedProduct || fields.product.value !== requestedProduct.value) continue;

    const hostname = hostnameKey(url);
    if (seenHostnames.has(hostname)) continue;

    seenHostnames.add(hostname);
    candidates.push({ title, url, content, score, fields });
  }

  const enriched = await Promise.all(candidates.map(async candidate => {
    const primary = {
      product: candidate.fields.product?.value ?? null,
      moq: candidate.fields.moq?.value ?? null,
      price: candidate.fields.price?.value ?? null,
      // Medium country extraction may combine a city mention with a TLD; that is not reliable location evidence.
      supplierLocation: candidate.fields.country?.confidence === "high" ? candidate.fields.country.value : null,
      delivery: { region: normalizedDeliveryRegion, status: "not_confirmed" as const, evidence: null, sourceUrl: null, sourceType: null },
    };
    const verification = await enrichSupplier(
      { title: candidate.title, url: candidate.url },
      requestedProduct.value,
      normalizedDeliveryRegion,
      (enrichmentQuery, options) => tavilySearch(apiKey, enrichmentQuery, options),
    );
    const fields = mergeEnrichment(primary, verification);
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
    console.info("supplier_search_diagnostics", {
      event: "supplier_search_diagnostics",
      requestId,
      results: diagnosticResults,
      summary: {
        rawResultCount: tavilyResults.length,
        qualifiedResultCount,
        returnedResultCount: results.length,
      },
    });
  }

  response.status(200).json({
    query: normalizedQuery,
    deliveryRegion: normalizedDeliveryRegion,
    results,
  });
}
