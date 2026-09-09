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
  price: { displayValue: string | null; type: PriceType; sourceUrl: string | null };
  sources: string[];
}

export interface ProductionSupplier {
  title: string;
  url: string;
  content: string;
  score: number;
  product: string;
  country: null;
  supplierLocation: string | null;
  price: string | null;
  delivery: {
    region: string;
    status: "confirmed";
    evidence: string;
    sourceUrl: string;
    sourceType: "external";
  };
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
        required: ["name", "website", "location", "product", "delivery", "price", "sources"],
        properties: {
          name: { type: "string" },
          website: { type: ["string", "null"] },
          location: { type: ["string", "null"] },
          product: { $ref: "#/$defs/evidencedText" },
          delivery: {
            type: "object", additionalProperties: false,
            required: ["status", "displayValue", "sourceUrl", "evidenceText"],
            properties: {
              status: { type: "string", enum: ["confirmed", "not_confirmed"] },
              displayValue: { type: ["string", "null"] }, sourceUrl: { type: ["string", "null"] },
              evidenceText: { type: ["string", "null"] },
            },
          },
          price: {
            type: "object", additionalProperties: false,
            required: ["displayValue", "type", "sourceUrl", "evidenceText"],
            properties: {
              displayValue: { type: ["string", "null"] },
              type: { type: "string", enum: [...PRICE_TYPES] }, sourceUrl: { type: ["string", "null"] },
              evidenceText: { type: ["string", "null"] },
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

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
}

function explicitlySupportsDelivery(evidence: string | null, deliveryRegion: string): boolean {
  if (!evidence || !deliveryRegion) return false;
  const claim = normalized(evidence);
  const deliveryAction = /\b(?:deliver(?:y|ies|ed|ing)?|ship(?:s|ped|ping)?|dispatch(?:es|ed|ing)?|send(?:s|ing)?|service)\b|достав|відправ|надсила|доставк|отправ|доставляем/iu.test(claim);
  const regionTokens = normalized(deliveryRegion).split(/[^\p{L}\p{N}]+/u).filter(token => token.length >= 4);
  const mentionsRegion = regionTokens.some(token => claim.includes(token.length >= 5 ? token.slice(0, 5) : token));
  return deliveryAction && mentionsRegion;
}

function validatedPriceType(price: Record<string, unknown>, evidence: string): PriceType {
  const requestedType = text(price.type) as PriceType | null;
  if (requestedType !== "wholesale") return requestedType && PRICE_TYPES.has(requestedType) ? requestedType : "unknown";
  const claim = normalized(evidence);
  const amount = text(price.displayValue)?.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(",", ".");
  if (!amount) return "unknown";
  const escapedAmount = amount.replace(".", "[.,]");
  const priceSpecificWholesale = new RegExp(`(?:wholesale|b2b|volume|quantity|оптов\\p{L}*|гуртов\\p{L}*)[^.\\n]{0,45}(?:price|ціна|вартість|tier|${escapedAmount})`, "iu").test(claim)
    && new RegExp(`(^|\\D)${escapedAmount}(?!\\d)`).test(claim);
  if (priceSpecificWholesale) return "wholesale";
  return /\bfrom\b|\bвід\s+\d|\bот\s+\d/iu.test(claim) ? "base" : "listed";
}

function explicitlySupportsPrice(price: Record<string, unknown>): string | null {
  const evidence = text(price.evidenceText);
  const displayValue = text(price.displayValue);
  if (!evidence || !displayValue) return null;
  const claim = normalized(evidence);
  if (/buyer|requested?|maximum|max\.?|покупц|запит|бажан|shipping\s+(?:fee|cost)|delivery\s+(?:fee|cost)|доставк\p{L}*\s+(?:вартіст|тариф)|minimum\s+order\s+value|мінімальн\p{L}*\s+сум/iu.test(claim)) return null;
  const amounts = displayValue.match(/\d+(?:[.,]\d+)?/g)?.map(value => Number(value.replace(",", "."))) ?? [];
  if (amounts.length === 0 || amounts.every(value => !Number.isFinite(value) || value <= 0)) return null;
  return evidence;
}

/** Remove unsupported model claims rather than promoting model prose to evidence. */
export function normalizeOpenAISuppliers(value: unknown, deliveryRegion = ""): OpenAISupplier[] {
  const rows = record(value).suppliers;
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((raw): OpenAISupplier[] => {
    const supplier = record(raw);
    const name = text(supplier.name);
    if (!name) return [];
    const product = record(supplier.product);
    const delivery = record(supplier.delivery);
    const price = record(supplier.price);
    const productSource = url(product.sourceUrl);
    const deliverySource = url(delivery.sourceUrl);
    const priceSource = url(price.sourceUrl);
    const website = url(supplier.website);
    const suppliedSources = Array.isArray(supplier.sources) ? supplier.sources.map(url).filter((item): item is string => item !== null) : [];
    const sources = [...new Set([website, productSource, deliverySource, priceSource, ...suppliedSources].filter((item): item is string => item !== null))];
    const priceEvidence = priceSource ? explicitlySupportsPrice(price) : null;
    const hasPriceEvidence = priceEvidence !== null;
    const deliveryEvidence = text(delivery.evidenceText);
    const hasDeliveryEvidence = deliverySource !== null && explicitlySupportsDelivery(deliveryEvidence, deliveryRegion);

    if (!productSource || !text(product.displayValue) || !hasDeliveryEvidence) return [];

    return [{
      name,
      website,
      location: text(supplier.location),
      product: { displayValue: productSource ? text(product.displayValue) : null, sourceUrl: productSource },
      delivery: {
        status: delivery.status === "confirmed" && hasDeliveryEvidence ? "confirmed" : "not_confirmed",
        displayValue: hasDeliveryEvidence ? text(delivery.displayValue) : null,
        sourceUrl: hasDeliveryEvidence ? deliverySource : null,
      },
      price: {
        displayValue: hasPriceEvidence ? text(price.displayValue) : null,
        type: hasPriceEvidence ? validatedPriceType(price, priceEvidence) : "unknown",
        sourceUrl: hasPriceEvidence ? priceSource : null,
      },
      sources,
    }];
  });
}

/** Keep the established /app contract while deriving Match only from verified evidence. */
export function toProductionSupplier(supplier: OpenAISupplier, deliveryRegion: string): ProductionSupplier {
  const url = supplier.website ?? supplier.product.sourceUrl ?? supplier.delivery.sourceUrl!;
  const score = Math.min(100, 80 + (supplier.price.displayValue ? 10 : 0) + (supplier.website ? 5 : 0) + (supplier.location ? 5 : 0)) / 100;
  return {
    title: supplier.name,
    url,
    content: supplier.product.displayValue!,
    score,
    product: supplier.product.displayValue!,
    country: null,
    supplierLocation: supplier.location,
    price: supplier.price.displayValue,
    delivery: {
      region: deliveryRegion,
      status: "confirmed",
      evidence: supplier.delivery.displayValue ?? "",
      sourceUrl: supplier.delivery.sourceUrl!,
      sourceType: "external",
    },
  };
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
  return `Research real B2B suppliers for the supplied request. Follow this bounded evidence workflow before producing JSON:
1. Understand the requested product and delivery market, including local market terminology.
2. Search for multiple concrete candidates. Prefer manufacturers, producers/roasters, distributors, wholesalers, HoReCa/B2B suppliers, and supplier-specific marketplace sellers with an identifiable seller. Generic retail stores must not outrank well-evidenced B2B suppliers.
3. Identify the concrete supplier, then inspect supplier-specific, product-relevant pages. Prefer first-party official sources; discovery pages and snippets may locate candidates but are not automatically supplier-owned evidence.
4. Independently verify delivery to the requested market. Location, market presence, Ukrainian identity, customers, or HoReCa positioning do not prove delivery. A foreign supplier remains eligible when shipping/service to the market is evidenced.
5. Verify price only when the numeric amount is bound to the relevant product. Reject shipping fees, order totals/MOV, discounts, zero values, and unrelated numbers; never select the smallest number on a page. Classify a price as wholesale only when that exact price has price-specific wholesale/B2B/volume-tier evidence. Otherwise use listed, base, negotiated, or unknown conservatively.
6. Price is optional enrichment, never an eligibility gate. Never copy a buyer maximum price into supplier facts. Missing facts remain null/unknown.
7. For each delivery and price claim, copy a short source excerpt into evidenceText and its real page URL into sourceUrl. The excerpt must directly support that fact; do not fabricate excerpts or URLs. The schema is not evidence.
8. Return a useful evidence-ranked shortlist, not merely the first search results. Requested product evidence plus confirmed delivery are required for usefulness.

The delivery market is not a supplier-country restriction. Unsupported facts must be null. Keep research bounded to a concise shortlist.`;
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
        tools: [{ type: "web_search", search_context_size: "high" }],
        instructions: instructions(query, deliveryRegion),
        input: JSON.stringify({ query, deliveryRegion }),
        text: { format: { type: "json_schema", name: "supplier_search_results", strict: true, schema: supplierSchema } },
      }),
    });
    if (!upstream.ok) throw new Error("OpenAI request failed");
    const raw: unknown = await upstream.json();
    const output = responseText(raw);
    if (!output) throw new Error("OpenAI response had no output text");
    const results = normalizeOpenAISuppliers(JSON.parse(output) as unknown, deliveryRegion)
      .map(supplier => toProductionSupplier(supplier, deliveryRegion));
    response.status(200).json({ query, deliveryRegion, results });
  } catch {
    response.status(502).json({ error: "Supplier web search is temporarily unavailable." });
  }
}
