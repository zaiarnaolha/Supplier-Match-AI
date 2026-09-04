declare const process: {
  env: {
    TAVILY_API_KEY?: string;
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

  const results = tavilyResults.map(
    ({ title, url, content, score }) => ({ title, url, content, score }),
  );

  response.status(200).json({
    query: normalizedQuery,
    deliveryRegion: normalizedDeliveryRegion,
    results,
  });
}
