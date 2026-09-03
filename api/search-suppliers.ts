declare const process: {
  env: {
    TAVILY_API_KEY?: string;
  };
};

interface SearchSuppliersBody {
  query?: unknown;
  deliveryRegion?: unknown;
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

  return Response.json({
    query: query.trim(),
    deliveryRegion: deliveryRegion.trim(),
    suppliers: [],
    message: "Supplier search is not connected to Tavily yet.",
  });
}
