declare const process: { env: { OPENAI_API_KEY?: string } };

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(statusCode: number): VercelResponse;
  setHeader(name: string, value: string): VercelResponse;
  json(body: unknown): void;
}

type PriceType = "wholesale" | "listed" | "base" | "negotiated" | "unknown";

export interface OpenAISupplier {
  name: string;
  website: string | null;
  location: string | null;
  product: { displayValue: string | null; sourceUrl: string | null };
  delivery: { status: "confirmed" | "not_confirmed"; displayValue: string | null; sourceUrl: string | null };
  moq: { value: number | null; unit: string | null; displayValue: string | null; sourceUrl: string | null };
  price: { displayValue: string | null; type: PriceType; sourceUrl: string | null };
  sources: string[];
}

const MODEL = "gpt-5-mini";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const PRICE_TYPES = new Set<PriceType>(["wholesale", "listed", "base", "negotiated", "unknown"]);

const supplierSchema = {
  type: "object",
  additionalProperties: false,
  required: ["suppliers"],
  properties: {
    suppliers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "website", "location", "product", "delivery", "moq", "price", "sources"],
        properties: {
          name: { type: "string" },
          website: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
          product: { $ref: "#/$defs/evidencedText" },
          delivery: {
            type: "object", additionalProperties: false,
            required: ["status", "displayValue", "sourceUrl"],
            properties: {
              status: { type: "string", enum: ["confirmed", "not_confirmed"] },
              displayValue: { type: ["string", "null"] }, sourceUrl: { type: ["string", "null"] },
            },
          },
          moq: {
            type: "object", additionalProperties: false,
            required: ["value", "unit", "displayValue", "sourceUrl"],
            properties: {
              value: { type: ["number", "null"] }, unit: { type: ["string", "null"] },
              displayValue: { type: ["string", "null"] }, sourceUrl: { type: ["string", "null"] },
            },
          },
          price: {
            type: "object", additionalProperties: false,
            required: ["displayValue", "type", "sourceUrl"],
            properties: {
              displayValue: { type: ["string", "null"] },
              type: { type: "string", enum: [...PRICE_TYPES] }, sourceUrl: { type: ["string", "null"] },
            },
          },
          sources: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  $defs: {
    evidencedText: {
      type: "object", additionalProperties: false, required: ["displayValue", "sourceUrl"],
      properties: { displayValue: { type: ["string", "null"] }, sourceUrl: { type: ["string", "null"] } },
    },
  },
} as const;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function url(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Remove unsupported model claims rather than promoting model prose to evidence. */
export function normalizeOpenAISuppliers(value: unknown): OpenAISupplier[] {
  const rows = record(value).suppliers;
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((raw): OpenAISupplier[] => {
    const supplier = record(raw);
    const name = text(supplier.name);
    if (!name) return [];
    const product = record(supplier.product);
    const delivery = record(supplier.delivery);
    const moq = record(supplier.moq);
    const price = record(supplier.price);
    const productSource = url(product.sourceUrl);
    const deliverySource = url(delivery.sourceUrl);
    const moqSource = url(moq.sourceUrl);
    const priceSource = url(price.sourceUrl);
    const website = url(supplier.website);
    const suppliedSources = Array.isArray(supplier.sources) ? supplier.sources.map(url).filter((item): item is string => item !== null) : [];
    const sources = [...new Set([website, productSource, deliverySource, moqSource, priceSource, ...suppliedSources].filter((item): item is string => item !== null))];
    const hasMoqEvidence = moqSource !== null;
    const hasPriceEvidence = priceSource !== null;
    const rawPriceType = text(price.type) as PriceType | null;

    return [{
      name,
      website,
      location: text(supplier.location),
      product: { displayValue: productSource ? text(product.displayValue) : null, sourceUrl: productSource },
      delivery: {
        status: delivery.status === "confirmed" && deliverySource ? "confirmed" : "not_confirmed",
        displayValue: deliverySource ? text(delivery.displayValue) : null,
        sourceUrl: deliverySource,
      },
      moq: {
        value: hasMoqEvidence && typeof moq.value === "number" && Number.isFinite(moq.value) && moq.value >= 0 ? moq.value : null,
        unit: hasMoqEvidence ? text(moq.unit) : null,
        displayValue: hasMoqEvidence ? text(moq.displayValue) : null,
        sourceUrl: moqSource,
      },
      price: {
        displayValue: hasPriceEvidence ? text(price.displayValue) : null,
        type: hasPriceEvidence && rawPriceType && PRICE_TYPES.has(rawPriceType) ? rawPriceType : "unknown",
        sourceUrl: priceSource,
      },
      sources,
    }];
  });
}

function responseText(value: unknown): string | null {
  const response = record(value);
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) {
    const content = record(item).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const candidate = record(part).text;
      if (typeof candidate === "string") return candidate;
    }
  }
  return null;
}

function instructions(query: string, deliveryRegion: string): string {
  return `Find real suppliers, manufacturers, distributors, or wholesalers for the requested product using web search.\n\nRequested product/query: ${query}\nDelivery market: ${deliveryRegion}\n\nThe delivery market is NOT a restriction on supplier country. Prefer official supplier and product pages. Every material fact must have a supporting source URL; search snippets and your own prose are not evidence. Confirm delivery only when a source explicitly supports delivery to the requested market; otherwise use not_confirmed. MOQ and price are informational, never exclusion criteria. Never copy any buyer maximum MOQ or buyer maximum price from the query into supplier facts. If supplier MOQ or price is not verified, return null fields. Do not label a listed or base price wholesale unless the source explicitly supports wholesale pricing. Return a concise set of relevant suppliers.`;
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }
  let body = request.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body) as unknown; } catch { response.status(400).json({ error: "Request body must be valid JSON." }); return; }
  }
  const input = record(body);
  const query = text(input.query);
  const deliveryRegion = text(input.deliveryRegion);
  if (!query || !deliveryRegion) {
    response.status(400).json({ error: '"query" and "deliveryRegion" must be non-empty strings.' });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    response.status(500).json({ error: "Server configuration error: OpenAI is not configured." });
    return;
  }

  try {
    const upstream = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        tools: [{ type: "web_search" }],
        input: instructions(query, deliveryRegion),
        text: { format: { type: "json_schema", name: "supplier_search_results", strict: true, schema: supplierSchema } },
      }),
    });
    if (!upstream.ok) throw new Error("OpenAI request failed");
    const raw: unknown = await upstream.json();
    const output = responseText(raw);
    if (!output) throw new Error("OpenAI response had no output text");
    const results = normalizeOpenAISuppliers(JSON.parse(output) as unknown);
    response.status(200).json({ query, deliveryRegion, results });
  } catch {
    response.status(502).json({ error: "Supplier web search is temporarily unavailable." });
  }
}
