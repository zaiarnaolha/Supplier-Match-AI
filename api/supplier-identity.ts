export type DiscoverySourceType = "official" | "marketplace" | "directory" | "article" | "external";

export interface SupplierIdentity {
  name: string;
  domain: string | null;
  officialUrl: string | null;
  sourceType: DiscoverySourceType;
}

const MARKETPLACES = ["prom.ua", "agrotorg.net", "agrotorg.com", "alibaba.com", "amazon.com", "etsy.com"];
const DIRECTORY_HOSTS = ["all.biz", "europages.com", "kompass.com"];
const PLATFORM_NAMES = /^(?:prom(?:\.ua)?|agrotorg|alibaba|amazon|etsy|all\.biz|europages|kompass)$/iu;
const SELLER_LABEL = /(?:продавець|постачальник|компанія|виробник|seller|supplier|sold\s+by|company|manufacturer)\s*[:—-]\s*([\p{L}\p{N}][\p{L}\p{N}&'’"“” ._-]{1,70})/iu;
const OFFICIAL_SITE = /(?:офіційний\s+сайт|сайт\s+(?:компанії|продавця)|official\s+(?:web)?site|company\s+(?:web)?site)\s*[:—-]?\s*(https?:\/\/[^\s,;)]+|(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s,;)]*)?)/iu;

function host(url: string): string {
  try { return new URL(url).hostname.toLocaleLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function canonicalSupplierDomain(value: string): string {
  const hostname = value.includes("://") ? host(value) : value.toLocaleLowerCase().replace(/^www\./, "").split("/")[0];
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length <= 2) return hostname;
  const compoundSuffix = /^(?:com|net|org|co)\.[a-z]{2}$/iu.test(labels.slice(-2).join("."));
  return labels.slice(compoundSuffix ? -3 : -2).join(".");
}

export function sourceTypeForUrl(url: string): DiscoverySourceType {
  const hostname = canonicalSupplierDomain(url);
  const pathname = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
  if (MARKETPLACES.includes(hostname)) return "marketplace";
  if (DIRECTORY_HOSTS.includes(hostname)) return "directory";
  if (/\/(?:blog|news|articles?|guides?|reviews?)(?:\/|$)/iu.test(pathname)) return "article";
  return "official";
}

function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[|–—-].*$/u, "").replace(/[.,;:]$/u, "").trim();
}

function urlFromMention(value: string): string {
  return /^https?:\/\//iu.test(value) ? value : `https://${value}`;
}

export function identifySupplier(title: string, content: string, url: string): SupplierIdentity | null {
  const sourceType = sourceTypeForUrl(url);
  const text = `${title}. ${content}`.replace(/\s+/g, " ");
  if (sourceType === "marketplace" || sourceType === "directory" || sourceType === "article") {
    const seller = text.match(SELLER_LABEL)?.[1];
    if (!seller) return null;
    const name = cleanName(seller);
    if (name.length < 2 || PLATFORM_NAMES.test(name)) return null;
    const officialMention = text.match(OFFICIAL_SITE)?.[1] ?? null;
    const officialUrl = officialMention ? urlFromMention(officialMention) : null;
    const domain = officialUrl ? canonicalSupplierDomain(officialUrl) : null;
    if (domain && MARKETPLACES.includes(domain)) return null;
    return { name, domain, officialUrl, sourceType };
  }

  const domain = canonicalSupplierDomain(url);
  const titleName = cleanName(title.replace(/\s*[|:]\s*.*/u, ""));
  const name = titleName.length >= 2 ? titleName : domain.split(".")[0];
  if (!domain || PLATFORM_NAMES.test(name)) return null;
  return { name, domain, officialUrl: url, sourceType };
}

export function supplierIdentityKey(identity: SupplierIdentity): string {
  return identity.domain
    ? `domain:${canonicalSupplierDomain(identity.domain)}`
    : `name:${identity.name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}`;
}
