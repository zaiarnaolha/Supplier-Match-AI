import { extractProduct } from "./supplier-extraction";
import { classifySourceRole, companyIdentityKey, identifySupplier, officialDomainCompanyBridgeKey, sourceTypeForUrl, supplierIdentityKeys, verifiedCompanyIdentityKey, type DiscoverySourceType, type SourceRole, type SupplierIdentity } from "./supplier-identity";
import { qualifySupplierCandidate } from "./supplier-qualification";

export type DiscoveryPass = "primary" | "commercial" | "complementary" | "enrichment";

export interface DiscoveryEvidence {
  title: string;
  url: string;
  content: string;
  score: number;
  sourceType: DiscoverySourceType;
  sourceRole: SourceRole;
  discoveryPass: DiscoveryPass;
}

export interface IdentityResolution {
  evidence: DiscoveryEvidence;
  identity: SupplierIdentity | null;
  identityResolved: boolean;
  identityRejectedReason: string | null;
  b2bQualified: boolean;
  b2bEvidence: string[];
  companyIdentityKey: string | null;
  dedupeDecision: "rejected" | "new_company" | "merged_company";
}

export interface ResolvedSupplier {
  identity: SupplierIdentity;
  evidence: DiscoveryEvidence[];
  primaryEvidence: DiscoveryEvidence;
  equivalenceKeys: string[];
}

export function asDiscoveryEvidence(results: Array<{ title: string; url: string; content: string; score: number }>, discoveryPass: DiscoveryPass): DiscoveryEvidence[] {
  return results.map(result => ({ ...result, sourceType: sourceTypeForUrl(result.url), sourceRole: classifySourceRole(result.title, result.content, result.url), discoveryPass }));
}

function identityPreference(identity: SupplierIdentity): number {
  return Number(identity.sourceType === "official") * 4 + Number(identity.identitySource === "company_label") * 2 + Number(identity.confidence === "high");
}

export function resolveSupplierIdentities(evidence: DiscoveryEvidence[]): { suppliers: ResolvedSupplier[]; resolutions: IdentityResolution[] } {
  const evaluated = evidence.map(item => {
    const identity = identifySupplier(item.title, item.content, item.url);
    const qualification = qualifySupplierCandidate(item.title, item.content, item.url);
    return { item, identity, qualification };
  });
  const qualified = evaluated.map((value, evidenceIndex) => ({ ...value, evidenceIndex }))
    .filter((value): value is typeof value & { identity: SupplierIdentity } => Boolean(value.identity && value.qualification.qualified));
  const parents = qualified.map((_, index) => index);
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };
  const directOwners = new Map<string, number>();
  for (const [index, value] of qualified.entries()) {
    for (const key of supplierIdentityKeys(value.identity)) {
      const owner = directOwners.get(key);
      if (owner === undefined) directOwners.set(key, index); else union(owner, index);
    }
  }
  const verifiedOwners = new Map<string, number>();
  for (const [index, value] of qualified.entries()) {
    const key = verifiedCompanyIdentityKey(value.identity);
    if (key) {
      const owner = verifiedOwners.get(key);
      if (owner === undefined) verifiedOwners.set(key, index); else union(owner, index);
    }
  }
  for (const [index, value] of qualified.entries()) {
    const bridgeKey = officialDomainCompanyBridgeKey(value.identity);
    const verifiedOwner = bridgeKey ? verifiedOwners.get(bridgeKey) : undefined;
    if (verifiedOwner !== undefined) union(verifiedOwner, index);
  }

  const members = new Map<number, typeof qualified>();
  for (const [index, value] of qualified.entries()) {
    const root = find(index);
    const group = members.get(root) ?? [];
    group.push(value);
    members.set(root, group);
  }
  const suppliers = [...members.values()].sort((left, right) => left[0].evidenceIndex - right[0].evidenceIndex).map(group => {
    const preferred = group.reduce((best, value) => identityPreference(value.identity) > identityPreference(best.identity) ? value : best);
    const primary = group.reduce((best, value) => value.item.score > best.item.score ? value : best);
    const aliases = [...new Set(group.flatMap(value => value.identity.aliases))];
    const identity = { ...preferred.identity, aliases };
    const verifiedKeys = new Set(group.map(value => verifiedCompanyIdentityKey(value.identity)).filter((key): key is string => Boolean(key)));
    const equivalenceKeys = [...new Set(group.flatMap(value => [
      ...supplierIdentityKeys(value.identity),
      ...(officialDomainCompanyBridgeKey(value.identity) && verifiedKeys.has(officialDomainCompanyBridgeKey(value.identity)!)
        ? [officialDomainCompanyBridgeKey(value.identity)!] : []),
    ]))];
    return { identity, evidence: group.map(value => value.item), primaryEvidence: primary.item, equivalenceKeys };
  });
  const supplierByEvidence = new Map<number, ResolvedSupplier>();
  for (const supplier of suppliers) {
    for (const item of supplier.evidence) supplierByEvidence.set(evidence.indexOf(item), supplier);
  }
  const firstEvidenceBySupplier = new Map<ResolvedSupplier, number>();
  for (const [index, supplier] of supplierByEvidence) {
    firstEvidenceBySupplier.set(supplier, Math.min(firstEvidenceBySupplier.get(supplier) ?? index, index));
  }
  const resolutions = evaluated.map(({ item, identity, qualification }, evidenceIndex) => {
    const resolved = Boolean(identity && qualification.qualified);
    const supplier = supplierByEvidence.get(evidenceIndex);
    return {
      evidence: item, identity, identityResolved: resolved,
      identityRejectedReason: !identity ? "concrete supplier identity not resolved" : !qualification.qualified ? qualification.reason : null,
      b2bQualified: qualification.qualified,
      b2bEvidence: qualification.qualified ? qualification.evidence : [],
      companyIdentityKey: identity && qualification.qualified ? companyIdentityKey(identity) : null,
      dedupeDecision: !resolved ? "rejected" : firstEvidenceBySupplier.get(supplier!) === evidenceIndex ? "new_company" : "merged_company",
    } satisfies IdentityResolution;
  });
  return { suppliers, resolutions };
}

function normalizedProductText(value: string): string {
  return value.toLocaleLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function requestedProductPresent(title: string, content: string, requestedProduct: string): boolean {
  const requested = normalizedProductText(requestedProduct);
  if (!requested) return false;
  const text = ` ${normalizedProductText(`${title} ${content}`)} `;
  return text.includes(` ${requested} `);
}

export function evidenceProduct(evidence: DiscoveryEvidence[], requestedProduct: string): string | null {
  const requestedCanonical = extractProduct(requestedProduct, "", "")?.value;
  return evidence.some(item => {
    const extracted = extractProduct(item.title, item.content, item.url)?.value;
    if (requestedCanonical && extracted === requestedCanonical) return true;
    return requestedProductPresent(item.title, item.content, requestedProduct);
  }) ? requestedProduct : null;
}
