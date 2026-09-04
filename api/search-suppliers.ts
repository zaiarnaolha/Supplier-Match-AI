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

interface SupplierSearchResult extends TavilyResult {
  product: string | null;
  location: string | null;
}

const PRODUCT_STOP_WORDS = new Set([
  "actual", "and", "або", "для", "доставка", "доставкою", "доставки", "знайти",
  "запит", "із", "компанія", "купити", "manufacturer", "manufacturers", "мені",
  "опт", "оптовик", "оптовики", "потрібен", "потрібна", "потрібні", "постачальник",
  "постачальника", "постачальники", "постачальників", "продаж", "регіон", "supplier",
  "suppliers", "виробник", "виробника", "виробники", "дистриб'ютор", "дистриб’ютор",
  "дистриб'ютора", "дистриб’ютора", "distributor", "distributors", "wholesale",
  "wholesaler", "wholesalers", "with", "шукаю", "що", "який", "яка", "які",
]);

function words(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? [];
}

function extractProduct(
  query: string,
  deliveryRegion: string,
  title: string,
  content: string,
): string | null {
  const excludedWords = new Set([...PRODUCT_STOP_WORDS, ...words(deliveryRegion)]);
  const sourceWords = new Set(words(`${title} ${content}`));
  const queryWords = words(query);
  let bestMatch: string[] = [];
  let currentMatch: string[] = [];

  for (const word of queryWords) {
    if (word.length >= 3 && !excludedWords.has(word) && sourceWords.has(word)) {
      currentMatch.push(word);
      if (currentMatch.length > bestMatch.length) bestMatch = [...currentMatch];
    } else {
      currentMatch = [];
    }
  }

  return bestMatch.length > 0 ? bestMatch.join(" ") : null;
}

function extractLocation(title: string, content: string): string | null {
  const text = `${title}. ${content}`.replace(/\s+/g, " ");
  const patterns = [
    /\b(?:based|located|headquartered)\s+in\s+([^.;|\n]{2,80})/iu,
    /\b(?:headquarters|location|address)\s*:\s*([^.;|\n]{2,80})/iu,
    /(?:розташован\p{L}*|базується|знаходиться)\s+(?:у|в)\s+([^.;|\n]{2,80})/iu,
    /(?:адреса|місцезнаходження)\s*:\s*([^.;|\n]{2,80})/iu,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1]
      ?.split(/\s+(?:and|but|that|which|with|та|але|що|який|яка|яке|які)\s+/iu, 1)[0]
      .trim()
      .replace(/[,\s]+$/, "");
    if (match) return match;
  }

  return null;
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

  for (const { title, url, content, score } of tavilyResults) {
    const hostname = hostnameKey(url);
    if (seenHostnames.has(hostname)) continue;

    seenHostnames.add(hostname);
    results.push({
      title,
      url,
      content,
      score,
      product: extractProduct(
        normalizedQuery,
        normalizedDeliveryRegion,
        title,
        content,
      ),
      location: extractLocation(title, content),
    });
  }

  response.status(200).json({
    query: normalizedQuery,
    deliveryRegion: normalizedDeliveryRegion,
    results,
  });
}
