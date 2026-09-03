declare const process: {
  env: {
    TAVILY_API_KEY?: string;
  };
};

interface SearchSuppliersBody {
  query?: unknown;
  deliveryRegion?: unknown;
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

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed. Use POST." },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(
      { error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  const { query, deliveryRegion } = body as SearchSuppliersBody;

  if (typeof query !== "string" || query.trim().length === 0) {
    return Response.json(
      { error: 'The "query" field must be a non-empty string.' },
      { status: 400 },
    );
  }

  if (typeof deliveryRegion !== "string") {
    return Response.json(
      { error: 'The "deliveryRegion" field must be a string.' },
      { status: 400 },
    );
  }

  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "Server configuration error: TAVILY_API_KEY is not set." },
      { status: 500 },
    );
  }

  const normalizedQuery = query.trim();
  const normalizedDeliveryRegion = deliveryRegion.trim();
  const searchQuery = [
    normalizedQuery,
    normalizedDeliveryRegion && `delivery region: ${normalizedDeliveryRegion}`,
    "wholesale suppliers",
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
    return Response.json(
      { error: "Supplier search service is currently unavailable." },
      { status: 502 },
    );
  }

  if (!tavilyResponse.ok) {
    return Response.json(
      { error: "Supplier search service returned an error." },
      { status: 502 },
    );
  }

  let tavilyData: unknown;

  try {
    tavilyData = await tavilyResponse.json();
  } catch {
    return Response.json(
      { error: "Supplier search service returned an invalid response." },
      { status: 502 },
    );
  }

  if (tavilyData === null || typeof tavilyData !== "object" || Array.isArray(tavilyData)) {
    return Response.json(
      { error: "Supplier search service returned an unexpected response." },
      { status: 502 },
    );
  }

  const tavilyResults = (tavilyData as Record<string, unknown>).results;

  if (!Array.isArray(tavilyResults) || !tavilyResults.every(isTavilyResult)) {
    return Response.json(
      { error: "Supplier search service returned an unexpected response." },
      { status: 502 },
    );
  }

  const results = tavilyResults.map(
    ({ title, url, content, score }) => ({ title, url, content, score }),
  );

  return Response.json({
    query: normalizedQuery,
    deliveryRegion: normalizedDeliveryRegion,
    results,
  });
}
