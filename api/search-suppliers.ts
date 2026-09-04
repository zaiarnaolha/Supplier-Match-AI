import { extractSupplierFields } from "./supplier-extraction";
import { qualifySupplierCandidate } from "./supplier-qualification";

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
  moq: string | null;
  price: string | null;
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
  const searchQuery = [
    normalizedQuery,
    normalizedDeliveryRegion && `delivery region: ${normalizedDeliveryRegion}`,
    "Find actual suppliers, manufacturers, distributors, or wholesalers that sell or distribute the requested product.",
    "Prioritize official supplier or manufacturer websites, product catalog pages, and wholesale or B2B supplier pages.",
    "Exclude blog posts, news articles, guides, educational content, how to choose a supplier articles, and general informational pages.",
  ]
    .filter(Boolean)
    .join(" ");

  let tavilyResponse: Response;

  try {
    tavilyResponse = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: searchQuery,
        search_depth: "basic",
        topic: "general",
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
    });
  } catch {
    response.status(502).json({
      error: "Supplier search service is currently unavailable.",
    });
    return;
  }

  if (!tavilyResponse.ok) {
    response.status(502).json({
      error: "Supplier search service returned an error.",
    });
    return;
  }

  let tavilyData: unknown;

  try {
    tavilyData = await tavilyResponse.json();
  } catch {
    response.status(502).json({
      error: "Supplier search service returned an invalid response.",
    });
    return;
  }

  if (tavilyData === null || typeof tavilyData !== "object" || Array.isArray(tavilyData)) {
    response.status(502).json({
      error: "Supplier search service returned an unexpected response.",
    });
    return;
  }

  const tavilyResults = (tavilyData as Record<string, unknown>).results;

  if (!Array.isArray(tavilyResults) || !tavilyResults.every(isTavilyResult)) {
    response.status(502).json({
      error: "Supplier search service returned an unexpected response.",
    });
    return;
  }

  const seenHostnames = new Set<string>();
  const results: SupplierSearchResult[] = [];
  const diagnosticsEnabled =
    process.env.VERCEL_ENV === "preview" &&
    process.env.SUPPLIER_SEARCH_DIAGNOSTICS === "true";
  const requestId = diagnosticsEnabled
    ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    : null;
  let qualifiedResultCount = 0;

  for (const [resultIndex, { title, url, content, score }] of tavilyResults.entries()) {
    const qualification = qualifySupplierCandidate(title, content, url);

    if (diagnosticsEnabled) {
      if ("reason" in qualification) {
        console.info("supplier_search_qualification", {
          requestId,
          resultIndex,
          title,
          url,
          content,
          qualified: false,
          reason: qualification.reason,
          confidence: null,
          evidence: [],
        });
      } else {
        console.info("supplier_search_qualification", {
          requestId,
          resultIndex,
          title,
          url,
          content,
          qualified: true,
          reason: null,
          confidence: qualification.confidence,
          evidence: qualification.evidence,
        });
      }
    }

    if (!qualification.qualified) continue;
    qualifiedResultCount += 1;

    const hostname = hostnameKey(url);
    if (seenHostnames.has(hostname)) continue;

    seenHostnames.add(hostname);
    const fields = extractSupplierFields(title, content, url);
    results.push({
      title,
      url,
      content,
      score,
      product: fields.product?.value ?? null,
      country: fields.country?.value ?? null,
      moq: fields.moq?.value ?? null,
      price: fields.price?.value ?? null,
    });
  }

  if (diagnosticsEnabled) {
    console.info("supplier_search_summary", {
      requestId,
      rawResultCount: tavilyResults.length,
      qualifiedResultCount,
      returnedResultCount: results.length,
    });
  }

  response.status(200).json({
    query: normalizedQuery,
    deliveryRegion: normalizedDeliveryRegion,
    results,
  });
}
