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

export const OPENAI_MODEL = "gpt-5-mini";
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const PRICE_TYPES = new Set<PriceType>(["wholesale", "listed", "base", "negotiated", "unknown"]);

export const supplierSchema = {
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
            required: ["status", "displayValue", "sourceUrl", "evidenceText"],
            properties: {
              status: { type: "string", enum: ["confirmed", "not_confirmed"] },
              displayValue: { type: ["string", "null"] }, sourceUrl: { type: ["string", "null"] },
              evidenceText: { type: ["string", "null"] },
            },
          },
          moq: {
            type: "object", additionalProperties: false,
            required: ["value", "unit", "displayValue", "sourceUrl", "evidenceText"],
            properties: {
              value: { type: ["number", "null"] }, unit: { type: ["string", "null"] },
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

export function evidenceText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function evidenceUrl(value: unknown): string | null {
  const candidate = evidenceText(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function evidenceRecord(value: unknown): Record<string, unknown> {
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

function explicitlySupportsMoq(moq: Record<string, unknown>): boolean {
  const evidence = evidenceText(moq.evidenceText);
  const unit = evidenceText(moq.unit);
  if (!evidence || !unit || typeof moq.value !== "number" || !Number.isFinite(moq.value) || moq.value <= 0) return false;
  const claim = normalized(evidence);
  if (/buyer|requested?|maximum|max\.?|до\s+\d|покупц|запит|бажан/iu.test(claim)) return false;
  const minimumOrder = /\b(?:moq|minimum\s+(?:wholesale\s+)?(?:order|purchase|quantity)|wholesale\s+(?:orders?\s+)?from)\b|мінімальн\p{L}*\s+(?:замовлен|парті|кількіст|обсяг)|замовлення\s+від|опт(?:ом)?\s+від|гуртом\s+від|минимальн\p{L}*\s+(?:заказ|парт)/iu.test(claim);
  const quantity = String(moq.value).replace(".", "[.,]");
  return minimumOrder && new RegExp(`(^|\\D)${quantity}(?!\\d)`).test(claim) && claim.includes(normalized(unit).slice(0, 2));
}

function validatedPriceType(price: Record<string, unknown>, evidence: string): PriceType {
  const requestedType = evidenceText(price.type) as PriceType | null;
  if (requestedType !== "wholesale") return requestedType && PRICE_TYPES.has(requestedType) ? requestedType : "unknown";
  const claim = normalized(evidence);
  const amount = evidenceText(price.displayValue)?.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(",", ".");
  if (!amount) return "unknown";
  const escapedAmount = amount.replace(".", "[.,]");
  const priceSpecificWholesale = new RegExp(`(?:wholesale|b2b|volume|quantity|оптов\\p{L}*|гуртов\\p{L}*)[^.\\n]{0,45}(?:price|ціна|вартість|tier|${escapedAmount})`, "iu").test(claim)
    && new RegExp(`(^|\\D)${escapedAmount}(?!\\d)`).test(claim);
  if (priceSpecificWholesale) return "wholesale";
  return /\bfrom\b|\bвід\s+\d|\bот\s+\d/iu.test(claim) ? "base" : "listed";
}

function explicitlySupportsPrice(price: Record<string, unknown>): string | null {
  const evidence = evidenceText(price.evidenceText);
  const displayValue = evidenceText(price.displayValue);
  if (!evidence || !displayValue) return null;
  const claim = normalized(evidence);
  if (/buyer|requested?|maximum|max\.?|покупц|запит|бажан|shipping\s+(?:fee|cost)|delivery\s+(?:fee|cost)|доставк\p{L}*\s+(?:вартіст|тариф)|minimum\s+order\s+value|мінімальн\p{L}*\s+сум/iu.test(claim)) return null;
  const amounts = displayValue.match(/\d+(?:[.,]\d+)?/g)?.map(value => Number(value.replace(",", "."))) ?? [];
  if (amounts.length === 0 || amounts.every(value => !Number.isFinite(value) || value <= 0)) return null;
  return evidence;
}

/** Remove unsupported model claims rather than promoting model prose to evidence. */
export function normalizeOpenAISuppliers(value: unknown, deliveryRegion = ""): OpenAISupplier[] {
  const rows = evidenceRecord(value).suppliers;
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((raw): OpenAISupplier[] => {
    const supplier = evidenceRecord(raw);
    const name = evidenceText(supplier.name);
    if (!name) return [];
    const product = evidenceRecord(supplier.product);
    const delivery = evidenceRecord(supplier.delivery);
    const moq = evidenceRecord(supplier.moq);
    const price = evidenceRecord(supplier.price);
    const productSource = evidenceUrl(product.sourceUrl);
    const deliverySource = evidenceUrl(delivery.sourceUrl);
    const moqSource = evidenceUrl(moq.sourceUrl);
    const priceSource = evidenceUrl(price.sourceUrl);
    const website = evidenceUrl(supplier.website);
    const suppliedSources = Array.isArray(supplier.sources) ? supplier.sources.map(evidenceUrl).filter((item): item is string => item !== null) : [];
    const sources = [...new Set([website, productSource, deliverySource, moqSource, priceSource, ...suppliedSources].filter((item): item is string => item !== null))];
    const hasMoqEvidence = moqSource !== null && explicitlySupportsMoq(moq);
    const priceEvidence = priceSource ? explicitlySupportsPrice(price) : null;
    const hasPriceEvidence = priceEvidence !== null;
    const deliveryEvidence = evidenceText(delivery.evidenceText);
    const hasDeliveryEvidence = deliverySource !== null && explicitlySupportsDelivery(deliveryEvidence, deliveryRegion);

    return [{
      name,
      website,
      location: evidenceText(supplier.location),
      product: { displayValue: productSource ? evidenceText(product.displayValue) : null, sourceUrl: productSource },
      delivery: {
        status: delivery.status === "confirmed" && hasDeliveryEvidence ? "confirmed" : "not_confirmed",
        displayValue: hasDeliveryEvidence ? evidenceText(delivery.displayValue) : null,
        sourceUrl: hasDeliveryEvidence ? deliverySource : null,
      },
      moq: {
        value: hasMoqEvidence && typeof moq.value === "number" && Number.isFinite(moq.value) && moq.value >= 0 ? moq.value : null,
        unit: hasMoqEvidence ? evidenceText(moq.unit) : null,
        displayValue: hasMoqEvidence ? evidenceText(moq.displayValue) : null,
        sourceUrl: hasMoqEvidence ? moqSource : null,
      },
      price: {
        displayValue: hasPriceEvidence ? evidenceText(price.displayValue) : null,
        type: hasPriceEvidence ? validatedPriceType(price, priceEvidence) : "unknown",
        sourceUrl: hasPriceEvidence ? priceSource : null,
      },
      sources,
    }];
  });
}

export function openAIResponseText(value: unknown): string | null {
  const response = evidenceRecord(value);
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) {
    const content = evidenceRecord(item).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const candidate = evidenceRecord(part).text;
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
5. Verify MOQ only from language explicitly establishing a minimum order, minimum wholesale quantity, or minimum purchase requirement. Package/SKU size, product weight, or an available quantity is not MOQ.
6. Verify price only when the numeric amount is bound to the relevant product. Reject shipping fees, order totals/MOV, discounts, zero values, and unrelated numbers; never select the smallest number on a page. Classify a price as wholesale only when that exact price has price-specific wholesale/B2B/volume-tier evidence. Otherwise use listed, base, negotiated, or unknown conservatively.
7. MOQ and price are optional enrichment, never eligibility gates. Never copy buyer maximum MOQ/price into supplier facts. Missing facts remain null/unknown.
8. For each delivery, MOQ, and price claim, copy a short source excerpt into evidenceText and its real page URL into sourceUrl. The excerpt must directly support that fact; do not fabricate excerpts or URLs. The schema is not evidence.
9. Return a useful evidence-ranked shortlist, not merely the first search results. Requested product evidence plus confirmed delivery are required for usefulness.

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
  const input = evidenceRecord(body);
  const query = evidenceText(input.query);
  const deliveryRegion = evidenceText(input.deliveryRegion);
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
        model: OPENAI_MODEL,
        tools: [{ type: "web_search", search_context_size: "high" }],
        instructions: instructions(query, deliveryRegion),
        input: JSON.stringify({ query, deliveryRegion }),
        text: { format: { type: "json_schema", name: "supplier_search_results", strict: true, schema: supplierSchema } },
      }),
    });
    if (!upstream.ok) throw new Error("OpenAI request failed");
    const raw: unknown = await upstream.json();
    const output = openAIResponseText(raw);
    if (!output) throw new Error("OpenAI response had no output text");
    const results = normalizeOpenAISuppliers(JSON.parse(output) as unknown, deliveryRegion);
    response.status(200).json({ query, deliveryRegion, results });
  } catch {
    response.status(502).json({ error: "Supplier web search is temporarily unavailable." });
  }
}
