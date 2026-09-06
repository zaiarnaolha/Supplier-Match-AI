import {
  OPENAI_MODEL,
  OPENAI_RESPONSES_URL,
  evidenceRecord,
  evidenceText,
  evidenceUrl,
  normalizeOpenAISuppliers,
  openAIResponseText,
  supplierSchema,
  type OpenAISupplier,
} from "./search-suppliers-openai";

declare const process: { env: { OPENAI_API_KEY?: string } };

interface VercelRequest { method?: string; body?: unknown }
interface VercelResponse {
  status(statusCode: number): VercelResponse;
  setHeader(name: string, value: string): VercelResponse;
  json(body: unknown): void;
}

interface DiscoveryCandidate {
  candidateId: string;
  name: string;
  website: string | null;
  evidenceUrls: string[];
}

const MAX_CANDIDATES = 5;

const discoverySchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      maxItems: MAX_CANDIDATES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "website", "evidenceUrls"],
        properties: {
          name: { type: "string" },
          website: { type: ["string", "null"] },
          evidenceUrls: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const baseSupplierItems = supplierSchema.properties.suppliers.items;
const verificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["suppliers"],
  properties: {
    suppliers: {
      type: "array",
      maxItems: MAX_CANDIDATES,
      items: {
        ...baseSupplierItems,
        required: ["candidateId", ...baseSupplierItems.required],
        properties: { candidateId: { type: "string" }, ...baseSupplierItems.properties },
      },
    },
  },
  $defs: supplierSchema.$defs,
} as const;

function discoveryInstructions(deliveryRegion: string): string {
  return `DISCOVERY ONLY. Find at most ${MAX_CANDIDATES} concrete B2B suppliers relevant to the requested product and terminology used in ${deliveryRegion}. Prefer manufacturers, producers/roasters, distributors, wholesalers, HoReCa/B2B suppliers, or an identifiable supplier-specific marketplace seller. The supplier may be in any country. Do not require MOQ, price, or already-confirmed delivery at this stage. Establish a concrete supplier identity and return real useful evidence URLs. Do not fabricate URLs. Return only the structured discovery object.`;
}

function verificationInstructions(deliveryRegion: string): string {
  return `TARGETED VERIFICATION ONLY. Research every supplied candidate by candidateId; do not discover, add, substitute, rename, or omit candidates merely because facts are missing. Search deeper, preferring official first-party supplier pages.
For each candidate independently verify: (1) the requested product belonging to that supplier; (2) delivery, shipping, dispatch, service, or fulfilment explicitly to ${deliveryRegion}; (3) supplier MOQ only where wording explicitly states a minimum order/purchase/wholesale quantity; and (4) a numeric product-relevant price.
Location, nationality, market presence, customers, and HoReCa positioning do not prove delivery. Package/SKU/bag size and available product weight do not prove MOQ. Buyer constraints never become supplier facts. Keep an actual supplier MOQ even when above the buyer preference. Shipping fees, minimum order value, zero values, and unrelated numbers are not product price. A price is wholesale only when that exact price has wholesale/B2B/volume-tier evidence; otherwise use listed, base, negotiated, or unknown. MOQ and price are optional. Missing or unsupported facts must remain null/unknown.
For delivery, MOQ, and price include a short direct evidence excerpt and its real source URL. Do not fabricate evidence or URLs. Return the same candidateId for each researched identity.`;
}

function normalizeDiscovery(value: unknown): DiscoveryCandidate[] {
  const rows = evidenceRecord(value).candidates;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.slice(0, MAX_CANDIDATES).flatMap((raw, index) => {
    const candidate = evidenceRecord(raw);
    const name = evidenceText(candidate.name);
    const website = evidenceUrl(candidate.website);
    if (!name) return [];
    const identityKey = `${name.toLocaleLowerCase()}|${website ?? ""}`;
    if (seen.has(identityKey)) return [];
    seen.add(identityKey);
    const evidenceUrls = Array.isArray(candidate.evidenceUrls)
      ? [...new Set(candidate.evidenceUrls.map(evidenceUrl).filter((item): item is string => item !== null))]
      : [];
    return [{ candidateId: `candidate-${index + 1}`, name, website, evidenceUrls }];
  });
}

async function researchCall(
  apiKey: string,
  name: string,
  schema: object,
  instructions: string,
  input: object,
): Promise<unknown> {
  const upstream = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      tools: [{ type: "web_search", search_context_size: "high" }],
      instructions,
      input: JSON.stringify(input),
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }),
  });
  if (!upstream.ok) throw new Error("OpenAI request failed");
  const output = openAIResponseText(await upstream.json());
  if (!output) throw new Error("OpenAI response had no output text");
  return JSON.parse(output) as unknown;
}

function verifiedSuppliers(value: unknown, candidates: DiscoveryCandidate[], deliveryRegion: string): OpenAISupplier[] {
  const rows = evidenceRecord(value).suppliers;
  if (!Array.isArray(rows)) return [];
  const candidatesById = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
  const seen = new Set<string>();
  const matched = rows.flatMap(raw => {
    const row = evidenceRecord(raw);
    const candidateId = evidenceText(row.candidateId);
    const candidate = candidateId ? candidatesById.get(candidateId) : undefined;
    if (!candidate || seen.has(candidateId!)) return [];
    seen.add(candidateId!);
    return [{
      ...row,
      name: candidate.name,
      website: candidate.website,
      sources: [
        ...candidate.evidenceUrls,
        ...(Array.isArray(row.sources) ? row.sources : []),
      ],
    }];
  });
  return normalizeOpenAISuppliers({ suppliers: matched }, deliveryRegion);
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

  const diagnostics = { discoveryCalls: 0, verificationCalls: 0 };
  try {
    diagnostics.discoveryCalls = 1;
    const discovery = await researchCall(apiKey, "supplier_discovery", discoverySchema, discoveryInstructions(deliveryRegion), { query, deliveryRegion });
    const candidates = normalizeDiscovery(discovery);
    let verified: OpenAISupplier[] = [];
    if (candidates.length > 0) {
      diagnostics.verificationCalls = 1;
      const verification = await researchCall(
        apiKey,
        "supplier_verification",
        verificationSchema,
        verificationInstructions(deliveryRegion),
        { query, deliveryRegion, candidates },
      );
      verified = verifiedSuppliers(verification, candidates, deliveryRegion);
    }
    const results = verified.filter(supplier => supplier.product.displayValue && supplier.product.sourceUrl && supplier.delivery.status === "confirmed");
    response.status(200).json({
      query,
      deliveryRegion,
      results,
      diagnostics: {
        ...diagnostics,
        discoveredCandidateCount: candidates.length,
        verifiedCandidateCount: verified.length,
        rejectedByDeliveryCount: verified.filter(supplier => supplier.delivery.status !== "confirmed").length,
        finalEligibleCount: results.length,
        withVerifiedMoqCount: results.filter(supplier => supplier.moq.value !== null).length,
        withPriceCount: results.filter(supplier => supplier.price.displayValue !== null).length,
        missingFacts: {
          product: verified.filter(supplier => !supplier.product.displayValue).length,
          delivery: verified.filter(supplier => supplier.delivery.status !== "confirmed").length,
          moq: verified.filter(supplier => supplier.moq.value === null).length,
          price: verified.filter(supplier => supplier.price.displayValue === null).length,
        },
      },
    });
  } catch {
    response.status(502).json({ error: "Multi-step supplier research is temporarily unavailable." });
  }
}
