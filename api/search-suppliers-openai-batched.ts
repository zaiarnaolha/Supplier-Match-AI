declare const process: { env: { OPENAI_API_KEY?: string } };

interface VercelRequest { method?: string; body?: unknown }
interface VercelResponse {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string): VercelResponse;
  json(body: unknown): void;
}

export type PriceType = "wholesale" | "listed" | "base" | "negotiated" | "unknown";
export interface DiscoveryCandidate { candidateId: string; name: string; website: string | null; discoveryEvidenceUrls: string[] }
type Status = "confirmed" | "rejected" | "not_confirmed";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODEL = "gpt-5-mini";
export const MAX_DISCOVERY_CANDIDATES = 10;
export const VERIFICATION_BATCH_SIZE = 3;

const nullableString = { type: ["string", "null"] } as const;
const evidence = {
  type: "object", additionalProperties: false,
  required: ["status", "displayValue", "evidenceText", "sourceUrl", "rejectionReason"],
  properties: {
    status: { type: "string", enum: ["confirmed", "rejected", "not_confirmed", "accepted", "not_found"] },
    displayValue: nullableString, evidenceText: nullableString, sourceUrl: nullableString, rejectionReason: nullableString,
  },
} as const;

const discoverySchema = {
  type: "object", additionalProperties: false, required: ["candidates"],
  properties: { candidates: { type: "array", maxItems: MAX_DISCOVERY_CANDIDATES, items: {
    type: "object", additionalProperties: false, required: ["candidateId", "name", "website", "discoveryEvidenceUrls"],
    properties: { candidateId: { type: "string" }, name: { type: "string" }, website: nullableString,
      discoveryEvidenceUrls: { type: "array", items: { type: "string" } } },
  } } },
} as const;

const verificationSchema = {
  type: "object", additionalProperties: false, required: ["candidates"],
  properties: { candidates: { type: "array", items: {
    type: "object", additionalProperties: false,
    required: ["candidateId", "name", "website", "supplierLocation", "identityStatus", "identityRejectionReason", "product", "delivery", "price", "sources"],
    properties: {
      candidateId: { type: "string" }, name: { type: "string" }, website: nullableString, supplierLocation: nullableString,
      identityStatus: { type: "string", enum: ["accepted", "rejected"] }, identityRejectionReason: nullableString,
      product: evidence,
      delivery: evidence,
      price: { ...evidence, required: [...evidence.required, "type"], properties: { ...evidence.properties,
        type: { type: "string", enum: ["wholesale", "listed", "base", "negotiated", "unknown"] } } },
      sources: { type: "array", items: { type: "string" } },
    },
  } } },
} as const;

function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function string(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null }
function safeUrl(value: unknown): string | null {
  const candidate = string(value); if (!candidate) return null;
  try { const parsed = new URL(candidate); return /https?:/.test(parsed.protocol) ? parsed.href : null } catch { return null }
}
function domain(value: string | null): string | null { try { return value ? new URL(value).hostname.replace(/^www\./, "").toLowerCase() : null } catch { return null } }
function sourceBelongsToCandidate(source: string | null, website: string | null): boolean {
  if (!source || !website) return false;
  const sourceDomain = domain(source); const websiteDomain = domain(website);
  return Boolean(sourceDomain && websiteDomain && (sourceDomain === websiteDomain || sourceDomain.endsWith(`.${websiteDomain}`)));
}
function normalized(value: string | null): string { return (value ?? "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() }
function urls(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.map(safeUrl).filter((item): item is string => Boolean(item)))] : [] }

export function normalizeDiscovery(value: unknown): DiscoveryCandidate[] {
  const rows = object(value).candidates;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_DISCOVERY_CANDIDATES).flatMap((raw, index) => {
    const row = object(raw); const name = string(row.name); if (!name) return [];
    return [{ candidateId: `candidate-${String(index + 1).padStart(2, "0")}`, name, website: safeUrl(row.website), discoveryEvidenceUrls: urls(row.discoveryEvidenceUrls) }];
  });
}

export function makeVerificationBatches(candidates: DiscoveryCandidate[]): DiscoveryCandidate[][] {
  const batches: DiscoveryCandidate[][] = [];
  for (let index = 0; index < candidates.length; index += VERIFICATION_BATCH_SIZE) batches.push(candidates.slice(index, index + VERIFICATION_BATCH_SIZE));
  return batches;
}

function deliveryIsExplicit(text: string | null, region: string): boolean {
  const claim = normalized(text); const regionTokens = normalized(region).split(" ").filter(token => token.length >= 4);
  return /deliver|ship|dispatch|fulfil|service|достав|відправ|надсила|отправ/u.test(claim)
    && regionTokens.some(token => claim.includes(token.slice(0, Math.min(5, token.length))));
}
function priceIsValid(display: string | null, evidenceText: string | null): boolean {
  if (!display || !evidenceText || !/\d/.test(display) || !(display.match(/\d+(?:[.,]\d+)?/g) ?? []).some(n => Number(n.replace(",", ".")) > 0)) return false;
  return !/shipping\s*(fee|cost)|delivery\s*(fee|cost)|minimum\s+order\s+value|\bmov\b|order total|buyer|requested|max(?:imum)? price|доставк\p{L}*\s*(варт|тариф)|мінімальн\p{L}*\s+сум/iu.test(evidenceText);
}
function priceType(value: unknown, evidenceText: string): PriceType {
  const proposed = string(value) as PriceType | null;
  if (proposed === "wholesale" && !/(wholesale|b2b|volume|quantity|tier|оптов|гуртов)/iu.test(evidenceText)) return "listed";
  return proposed && ["wholesale", "listed", "base", "negotiated", "unknown"].includes(proposed) ? proposed : "unknown";
}

export function normalizeVerification(value: unknown, assigned: DiscoveryCandidate[], deliveryRegion: string) {
  const allowed = new Map(assigned.map(candidate => [candidate.candidateId, candidate]));
  const rows = object(value).candidates;
  const byId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(rows)) for (const raw of rows) { const row = object(raw); const id = string(row.candidateId); if (id && allowed.has(id) && !byId.has(id)) byId.set(id, row) }

  return assigned.map(candidate => {
    const row = byId.get(candidate.candidateId) ?? {};
    const proposedName = string(row.name); const proposedWebsite = safeUrl(row.website);
    const identityPreserved = Boolean(proposedName) && normalized(proposedName) === normalized(candidate.name)
      && (!candidate.website || domain(proposedWebsite) === domain(candidate.website));
    const product = object(row.product); const delivery = object(row.delivery); const price = object(row.price);
    const productSource = safeUrl(product.sourceUrl); const productText = string(product.evidenceText); const productDisplay = string(product.displayValue);
    const productConfirmed = identityPreserved && product.status === "confirmed" && Boolean(productText && productDisplay && sourceBelongsToCandidate(productSource, candidate.website));
    const deliverySource = safeUrl(delivery.sourceUrl); const deliveryText = string(delivery.evidenceText);
    const deliveryConfirmed = identityPreserved && delivery.status === "confirmed" && Boolean(sourceBelongsToCandidate(deliverySource, candidate.website) && deliveryIsExplicit(deliveryText, deliveryRegion));
    const priceSource = safeUrl(price.sourceUrl); const priceText = string(price.evidenceText); const priceDisplay = string(price.displayValue);
    const acceptedPrice = Boolean(sourceBelongsToCandidate(priceSource, candidate.website) && priceIsValid(priceDisplay, priceText));
    const eligible = identityPreserved && productConfirmed && deliveryConfirmed;
    const identityStatus = identityPreserved ? "accepted" : "rejected";
    const rejectionReason = !identityPreserved ? "supplier_identity_changed_or_missing" : !productConfirmed ? "requested_product_not_confirmed" : !deliveryConfirmed ? "delivery_to_region_not_confirmed" : null;
    return {
      candidateId: candidate.candidateId, name: candidate.name, website: candidate.website,
      supplierLocation: identityPreserved ? string(row.supplierLocation) : null,
      identityStatus, identityRejectionReason: identityPreserved ? null : "Verification did not preserve the discovered supplier identity.",
      product: { status: productConfirmed ? "confirmed" : (product.status === "rejected" ? "rejected" : "not_confirmed"), displayValue: productConfirmed ? productDisplay : null,
        evidenceText: productConfirmed ? productText : null, sourceUrl: productConfirmed ? productSource : null, rejectionReason: productConfirmed ? null : string(product.rejectionReason) ?? "Direct requested-product evidence was not accepted." },
      delivery: { region: deliveryRegion, status: deliveryConfirmed ? "confirmed" : "not_confirmed", displayValue: deliveryConfirmed ? string(delivery.displayValue) : null,
        evidenceText: deliveryConfirmed ? deliveryText : null, sourceUrl: deliveryConfirmed ? deliverySource : null,
        rejectionReason: deliveryConfirmed ? null : string(delivery.rejectionReason) ?? "No explicit shipping, delivery, dispatch, service, or fulfilment evidence to the requested region." },
      price: { status: acceptedPrice ? "accepted" : (price.status === "rejected" || priceDisplay || priceText ? "rejected" : "not_found"),
        displayValue: acceptedPrice ? priceDisplay : null, type: acceptedPrice ? priceType(price.type, priceText ?? "") : "unknown",
        evidenceText: acceptedPrice ? priceText : null, sourceUrl: acceptedPrice ? priceSource : null,
        rejectionReason: acceptedPrice ? null : (priceDisplay || priceText ? string(price.rejectionReason) ?? "Price evidence was not accepted." : null) },
      sources: [...new Set([...candidate.discoveryEvidenceUrls, ...urls(row.sources), productConfirmed ? productSource : null, deliveryConfirmed ? deliverySource : null, acceptedPrice ? priceSource : null].filter((url): url is string => Boolean(url)))],
      eligible, rejectionReason,
    };
  });
}

function responseText(value: unknown): string | null {
  const response = object(value); if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) { const content = object(item).content; if (Array.isArray(content)) for (const part of content) { const text = object(part).text; if (typeof text === "string") return text } }
  return null;
}
async function callOpenAI(apiKey: string, instructions: string, input: unknown, schemaName: string, schema: unknown): Promise<unknown> {
  const upstream = await fetch(RESPONSES_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({
    model: MODEL, tools: [{ type: "web_search", search_context_size: "high" }], instructions, input: JSON.stringify(input),
    text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
  }) });
  if (!upstream.ok) throw new Error("upstream_failed");
  const text = responseText(await upstream.json()); if (!text) throw new Error("missing_output");
  return JSON.parse(text) as unknown;
}

const discoveryInstructions = `Discover up to 10 concrete B2B supplier candidates relevant to the requested product. Ten is a maximum, never a target: omit weak candidates. Prefer manufacturers, producers or roasters, distributors, wholesalers, HoReCa/B2B suppliers, and identifiable supplier-specific marketplace sellers. Return stable candidateId values, concrete names, identifiable websites, and discovery evidence URLs. Delivery and price need not be confirmed. Do not research or return MOQ.`;
function verificationInstructions(region: string): string { return `Independently verify ONLY the assigned candidateIds; never discover substitutes, add suppliers, rename identities, or move evidence between candidates. For each candidate bind evidence to its concrete identity/domain. Accept the requested product only with direct evidence. Delivery to ${region} is a hard requirement and needs explicit shipping, delivery, dispatch, service, or fulfilment evidence naming that region; location, nationality, market presence, customers, imports, and generic Delivery navigation are insufficient. Price is optional. Accept only numeric product prices, not shipping fees, minimum order values, order totals, zeroes, unrelated numbers, or the buyer's requested/max price. A generic listed price is not wholesale without exact B2B/volume-tier evidence. Missing facts remain null. Do not research or return MOQ.` }

function summary(candidates: ReturnType<typeof normalizeVerification>) {
  return {
    discovered: candidates.length,
    identity: { accepted: candidates.filter(c => c.identityStatus === "accepted").length, rejected: candidates.filter(c => c.identityStatus === "rejected").length },
    product: { confirmed: candidates.filter(c => c.product.status === "confirmed").length, notConfirmed: candidates.filter(c => c.product.status !== "confirmed").length },
    delivery: { confirmed: candidates.filter(c => c.delivery.status === "confirmed").length, notConfirmed: candidates.filter(c => c.delivery.status !== "confirmed").length },
    price: { accepted: candidates.filter(c => c.price.status === "accepted").length, rejected: candidates.filter(c => c.price.status === "rejected").length, notFound: candidates.filter(c => c.price.status === "not_found").length },
    returnedSupplierCount: candidates.filter(c => c.eligible).length,
  };
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); response.status(405).json({ error: "Method not allowed. Use POST." }); return }
  let body = request.body; if (typeof body === "string") try { body = JSON.parse(body) } catch { response.status(400).json({ error: "Request body must be valid JSON." }); return }
  const input = object(body); const query = string(input.query); const deliveryRegion = string(input.deliveryRegion);
  if (!query || !deliveryRegion) { response.status(400).json({ error: '"query" and "deliveryRegion" must be non-empty strings.' }); return }
  const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) { response.status(500).json({ error: "Server configuration error: OpenAI is not configured." }); return }
  const started = Date.now(); let discoveryLatencyMs = 0; const batchDiagnostics: Array<Record<string, unknown>> = [];
  try {
    const discoveryStarted = Date.now();
    const discovered = normalizeDiscovery(await callOpenAI(apiKey, discoveryInstructions, { query, deliveryRegion }, "supplier_discovery", discoverySchema));
    discoveryLatencyMs = Date.now() - discoveryStarted;
    const verified = [];
    for (const [index, batch] of makeVerificationBatches(discovered).entries()) {
      const batchId = `batch-${index + 1}`; const batchStarted = Date.now();
      const batchDiagnostic: Record<string, unknown> = { batchId, candidateIds: batch.map(c => c.candidateId), attempted: true, completed: false, latencyMs: 0 };
      batchDiagnostics.push(batchDiagnostic);
      try {
        const raw = await callOpenAI(apiKey, verificationInstructions(deliveryRegion), { query, deliveryRegion, candidates: batch }, "supplier_verification", verificationSchema);
        const normalized = normalizeVerification(raw, batch, deliveryRegion); verified.push(...normalized);
        batchDiagnostic.completed = true;
      } finally { batchDiagnostic.latencyMs = Date.now() - batchStarted }
    }
    const diagnostics = {
      calls: { total: 1 + batchDiagnostics.length, discovery: 1, verification: batchDiagnostics.length },
      latency: { discoveryMs: discoveryLatencyMs, verificationBatches: batchDiagnostics.map(batch => ({ batchId: batch.batchId, latencyMs: batch.latencyMs })), totalMs: Date.now() - started },
      discovery: { discoveredCandidateCount: discovered.length, candidateIds: discovered.map(c => c.candidateId), candidates: discovered },
      verificationBatches: batchDiagnostics, candidates: verified, summary: summary(verified),
    };
    response.status(200).json({ query, deliveryRegion, suppliers: verified.filter(candidate => candidate.eligible).map(({ eligible: _eligible, rejectionReason: _reason, identityStatus: _identity, identityRejectionReason: _identityReason, ...supplier }) => supplier), diagnostics });
  } catch {
    response.status(502).json({ error: "Experimental supplier research is temporarily unavailable.", diagnostics: { calls: { discovery: 1, verification: batchDiagnostics.length }, discoveryLatencyMs, verificationBatches: batchDiagnostics } });
  }
}
