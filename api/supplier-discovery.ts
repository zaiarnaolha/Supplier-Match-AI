import { extractProduct } from "./supplier-extraction";
import { identifySupplier, sourceTypeForUrl, supplierIdentityKey, type DiscoverySourceType, type SupplierIdentity } from "./supplier-identity";
import { qualifySupplierCandidate } from "./supplier-qualification";

export type DiscoveryPass = "primary" | "commercial" | "complementary";

export interface DiscoveryEvidence {
  title: string;
  url: string;
  content: string;
  score: number;
  sourceType: DiscoverySourceType;
  discoveryPass: DiscoveryPass;
}

export interface IdentityResolution {
  evidence: DiscoveryEvidence;
  identity: SupplierIdentity | null;
  identityResolved: boolean;
  identityRejectedReason: string | null;
  b2bQualified: boolean;
  b2bEvidence: string[];
}

export interface ResolvedSupplier {
  identity: SupplierIdentity;
  evidence: DiscoveryEvidence[];
  primaryEvidence: DiscoveryEvidence;
}

export function asDiscoveryEvidence(results: Array<{ title: string; url: string; content: string; score: number }>, discoveryPass: DiscoveryPass): DiscoveryEvidence[] {
  return results.map(result => ({ ...result, sourceType: sourceTypeForUrl(result.url), discoveryPass }));
}

export function resolveSupplierIdentities(evidence: DiscoveryEvidence[]): { suppliers: ResolvedSupplier[]; resolutions: IdentityResolution[] } {
  const groups = new Map<string, ResolvedSupplier>();
  const resolutions = evidence.map(item => {
    const identity = identifySupplier(item.title, item.content, item.url);
    const qualification = qualifySupplierCandidate(item.title, item.content, item.url);
    const resolved = Boolean(identity && qualification.qualified);
    const resolution: IdentityResolution = {
      evidence: item, identity, identityResolved: resolved,
      identityRejectedReason: !identity ? "concrete supplier identity not resolved" : !qualification.qualified ? qualification.reason : null,
      b2bQualified: qualification.qualified,
      b2bEvidence: qualification.qualified ? qualification.evidence : [],
    };
    if (!identity || !qualification.qualified) return resolution;
    const key = supplierIdentityKey(identity);
    const current = groups.get(key);
    if (!current) groups.set(key, { identity, evidence: [item], primaryEvidence: item });
    else {
      current.evidence.push(item);
      if (item.score > current.primaryEvidence.score) current.primaryEvidence = item;
      if (identity.confidence === "high" && current.identity.confidence !== "high") current.identity = identity;
      current.identity.aliases = [...new Set([...current.identity.aliases, ...identity.aliases])];
    }
    return resolution;
  });
  return { suppliers: [...groups.values()], resolutions };
}

export function evidenceProduct(evidence: DiscoveryEvidence[], requestedProduct: string): string | null {
  return evidence.some(item => extractProduct(item.title, item.content, item.url)?.value === requestedProduct) ? requestedProduct : null;
}
