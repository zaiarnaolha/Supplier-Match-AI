import { extractProduct } from "./supplier-extraction";
import { classifySourceRole, companyIdentityKey, identifySupplier, sourceTypeForUrl, supplierIdentityKey, type DiscoverySourceType, type SourceRole, type SupplierIdentity } from "./supplier-identity";
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
}

export function asDiscoveryEvidence(results: Array<{ title: string; url: string; content: string; score: number }>, discoveryPass: DiscoveryPass): DiscoveryEvidence[] {
  return results.map(result => ({ ...result, sourceType: sourceTypeForUrl(result.url), sourceRole: classifySourceRole(result.title, result.content, result.url), discoveryPass }));
}

function identityPreference(identity: SupplierIdentity): number {
  return Number(identity.sourceType === "official") * 4 + Number(identity.identitySource === "company_label") * 2 + Number(identity.confidence === "high");
}

export function resolveSupplierIdentities(evidence: DiscoveryEvidence[]): { suppliers: ResolvedSupplier[]; resolutions: IdentityResolution[] } {
  const groups = new Map<string, ResolvedSupplier>();
  const suppliers: ResolvedSupplier[] = [];
  const resolutions = evidence.map(item => {
    const identity = identifySupplier(item.title, item.content, item.url);
    const qualification = qualifySupplierCandidate(item.title, item.content, item.url);
    const resolved = Boolean(identity && qualification.qualified);
    const key = identity && qualification.qualified ? companyIdentityKey(identity) : null;
    const identityKeys = identity && qualification.qualified
      ? [...new Set([key!, supplierIdentityKey(identity)])] : [];
    const current = identityKeys.map(identityKey => groups.get(identityKey)).find(Boolean);
    const resolution: IdentityResolution = {
      evidence: item, identity, identityResolved: resolved,
      identityRejectedReason: !identity ? "concrete supplier identity not resolved" : !qualification.qualified ? qualification.reason : null,
      b2bQualified: qualification.qualified,
      b2bEvidence: qualification.qualified ? qualification.evidence : [],
      companyIdentityKey: key,
      dedupeDecision: !resolved ? "rejected" : current ? "merged_company" : "new_company",
    };
    if (!identity || !qualification.qualified) return resolution;
    if (!current) {
      const supplier = { identity, evidence: [item], primaryEvidence: item };
      suppliers.push(supplier);
      for (const identityKey of identityKeys) groups.set(identityKey, supplier);
    }
    else {
      current.evidence.push(item);
      if (item.score > current.primaryEvidence.score) current.primaryEvidence = item;
      if (identityPreference(identity) > identityPreference(current.identity)) current.identity = identity;
      current.identity.aliases = [...new Set([...current.identity.aliases, ...identity.aliases])];
      for (const identityKey of identityKeys) groups.set(identityKey, current);
    }
    return resolution;
  });
  return { suppliers, resolutions };
}

export function evidenceProduct(evidence: DiscoveryEvidence[], requestedProduct: string): string | null {
  return evidence.some(item => extractProduct(item.title, item.content, item.url)?.value === requestedProduct) ? requestedProduct : null;
}
