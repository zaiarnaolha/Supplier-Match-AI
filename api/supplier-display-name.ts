import { canonicalSupplierDomain, identifySupplier, type SupplierIdentity } from "./supplier-identity";
import type { DiscoveryEvidence } from "./supplier-discovery";

const GENERIC_DISPLAY_NAME = /^(?:(?:coffee|tea|кава|чай)(?:\s+(?:beans?|зерн\p{L}*))?|supplier|seller|manufacturer|producer|distributor|wholesaler|catalog(?:ue)?|category|store|shop|product(?:s)?|товар\p{L}*|каталог|категорі\p{L}*|постачальник|продавець|виробник|дистриб['’]?ютор|опт|гурт)$/iu;
const PRODUCT_OR_PAGE_TITLE = /(?:купити|buy|price|ціна|wholesale|оптом|гуртом|catalog(?:ue)?|каталог|category|категорі\p{L}*|product(?:s)?|товар\p{L}*)/iu;

function normalizedName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function hostname(url: string): string {
  try { return new URL(url).hostname.toLocaleLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function genericDisplayName(value: string): boolean {
  const name = value.replace(/\s+/g, " ").trim();
  return GENERIC_DISPLAY_NAME.test(name) || PRODUCT_OR_PAGE_TITLE.test(name);
}

function formattingScore(value: string): number {
  const letters = value.match(/\p{L}/gu)?.join("") ?? "";
  const hasUpper = /\p{Lu}/u.test(letters);
  const hasLower = /\p{Ll}/u.test(letters);
  return Number(hasUpper && hasLower) * 4 + Number(/\s/u.test(value)) * 2 + Number(!/^[\p{Lu}\p{N}\W]+$/u.test(value));
}

type DisplayCandidate = { value: string; priority: number; formatting: number };

/**
 * Selects presentation text only. SupplierIdentity and its equivalence keys remain
 * the canonical source for identity, grouping, and deduplication.
 */
export function resolveSupplierDisplayName(identity: SupplierIdentity, evidence: DiscoveryEvidence[]): string {
  const canonicalDomain = identity.domain ? canonicalSupplierDomain(identity.domain) : "";
  const identityNames = new Set([
    normalizedName(identity.name),
    ...identity.aliases.map(normalizedName),
    canonicalDomain ? normalizedName(canonicalDomain.split(".")[0] ?? "") : "",
  ].filter(Boolean));
  const candidates: DisplayCandidate[] = [];

  for (const item of evidence) {
    const observed = identifySupplier(item.title, item.content, item.url);
    if (!observed || genericDisplayName(observed.name)) continue;
    const observedNormalized = normalizedName(observed.name);
    const sameOfficialDomain = Boolean(canonicalDomain)
      && item.sourceRole === "official_supplier"
      && canonicalSupplierDomain(hostname(item.url)) === canonicalDomain;
    const explicit = observed.identitySource === "company_label" || observed.identitySource === "seller_label";
    const exactExternalIdentity = identityNames.has(observedNormalized)
      || Boolean(canonicalDomain && observed.domain && canonicalSupplierDomain(observed.domain) === canonicalDomain);
    if (!identityNames.has(observedNormalized) && !(sameOfficialDomain && explicit) && !(explicit && exactExternalIdentity)) continue;
    const priority = sameOfficialDomain && explicit ? 3
      : !sameOfficialDomain && explicit ? 2
        : sameOfficialDomain ? 1 : 0;
    if (priority) candidates.push({ value: observed.name, priority, formatting: formattingScore(observed.name) });
  }

  const selected = candidates.sort((left, right) => right.priority - left.priority
    || right.formatting - left.formatting
    || left.value.localeCompare(right.value, "und", { sensitivity: "variant" }))[0];
  if (selected) return selected.value;

  if (!genericDisplayName(identity.name)) return identity.name;
  return canonicalDomain || identity.name;
}
