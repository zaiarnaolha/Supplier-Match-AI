export type DiscoverySourceType = "official" | "marketplace" | "directory" | "article" | "external";

export interface SupplierIdentity {
  name: string;
  domain: string | null;
  officialUrl: string | null;
  sourceType: DiscoverySourceType;
  aliases: string[];
  identitySource: "seller_label" | "company_label" | "official_domain";
  confidence: "high" | "medium";
}

const MARKETPLACES = ["prom.ua", "rozetka.com.ua", "agrotorg.net", "agrotorg.com", "alibaba.com", "amazon.com", "etsy.com"];
const DIRECTORY_HOSTS = ["all.biz", "europages.com", "kompass.com"];
const PLATFORM_HOSTS = ["instagram.com", "facebook.com", "threads.net", "tiktok.com", "youtube.com", "linkedin.com", "pinterest.com", "x.com", "twitter.com", "t.me", "vk.com"];
const PLATFORM_NAMES = /^(?:prom(?:\.ua)?|agrotorg|alibaba|amazon|etsy|all\.biz|europages|kompass)$/iu;
const SELLER_LABEL = /(?:продавець|постачальник|компанія|виробник|бренд|seller|supplier|sold\s+by|company|manufacturer|brand)\s*[:—-]\s*([\p{L}\p{N}!][\p{L}\p{N}!&'’"“” _-]{1,70}?)(?=\s*[|.;]|$)/iu;
const COMPANY_LABEL = /(?:brand|бренд|компанія|company|seller|продавець)\s*(?:name)?\s*[:—-]\s*([\p{L}\p{N}!][\p{L}\p{N}!&'’"“” _-]{1,70}?)(?=\s*[|.;]|$)/iu;
const OFFICIAL_SITE = /(?:офіційний\s+сайт|сайт\s+(?:компанії|продавця)|official\s+(?:web)?site|company\s+(?:web)?site)\s*[:—-]?\s*(https?:\/\/[^\s,;)]+|(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s,;)]*)?)/iu;
const PRODUCT_TITLE = /(?:кава|coffee|чай|tea|купити|ціна|price|catalog|каталог|товар|product)/iu;
const GENERIC_IDENTITY = /^(?:виробник|постачальник|дистриб['’]?ютор|продавець|seller|supplier|manufacturer|producer|distributor|wholesaler|catalog|каталог|category|категорія|store|shop|опт|гурт)$/iu;
const COMMERCIAL_TITLE = /(?:купити|ціна|price|оптом|гуртом|wholesale|каталог|catalog|товар|product|кава|coffee|чай|tea)/iu;

function host(url: string): string {
  try { return new URL(url).hostname.toLocaleLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function canonicalSupplierDomain(value: string): string {
  const hostname = value.includes("://") ? host(value) : value.toLocaleLowerCase().replace(/^www\./, "").split("/")[0];
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length <= 2) return hostname;
  const ukrainianPublicSuffix = /^(?:(?:com|net|org|co|biz|in|pp)|(?:ck|cn|cv|dp|dn|if|kh|km|kr|ks|kv|lg|lt|lv|mk|od|pl|rv|sb|sm|te|uz|vn|zp|zt|crimea|kiev|kyiv|sebastopol))\.ua$/iu;
  const compoundSuffix = /^(?:com|net|org|co)\.[a-z]{2}$/iu.test(labels.slice(-2).join("."))
    || ukrainianPublicSuffix.test(labels.slice(-2).join("."));
  return labels.slice(compoundSuffix ? -3 : -2).join(".");
}

export function sourceTypeForUrl(url: string): DiscoverySourceType {
  const hostname = canonicalSupplierDomain(url);
  const pathname = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
  if (MARKETPLACES.includes(hostname)) return "marketplace";
  if (DIRECTORY_HOSTS.includes(hostname)) return "directory";
  // Social and publishing platforms are evidence hosts, never supplier websites.
  if (PLATFORM_HOSTS.includes(hostname)) return "external";
  if (/\/(?:blog|news|articles?|guides?|reviews?)(?:\/|$)/iu.test(pathname)) return "article";
  return "official";
}

function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[|–—-].*$/u, "").replace(/[.,;:]$/u, "").trim();
}

function validConcreteName(value: string): boolean {
  const name = cleanName(value);
  return name.length >= 2 && !PLATFORM_NAMES.test(name) && !GENERIC_IDENTITY.test(name)
    && !(COMMERCIAL_TITLE.test(name) && name.split(/\s+/u).length > 3);
}

function nameFromDomain(domain: string): string {
  return (domain.split(".")[0] ?? "").split(/[-_]+/u).filter(Boolean)
    .map(part => part.length <= 3 ? part.toLocaleUpperCase() : `${part[0].toLocaleUpperCase()}${part.slice(1)}`).join(" ");
}

function urlFromMention(value: string): string {
  return /^https?:\/\//iu.test(value) ? value : `https://${value}`;
}

export function identifySupplier(title: string, content: string, url: string): SupplierIdentity | null {
  const sourceType = sourceTypeForUrl(url);
  const text = `${title}. ${content}`.replace(/\s+/g, " ");
  if (sourceType !== "official") {
    const seller = text.match(SELLER_LABEL)?.[1];
    if (!seller) return null;
    const name = cleanName(seller);
    if (!validConcreteName(name)) return null;
    const officialMention = text.match(OFFICIAL_SITE)?.[1] ?? null;
    const officialUrl = officialMention ? urlFromMention(officialMention) : null;
    const domain = officialUrl ? canonicalSupplierDomain(officialUrl) : null;
    if (domain && MARKETPLACES.includes(domain)) return null;
    return { name, domain, officialUrl, sourceType, aliases: [name], identitySource: "seller_label", confidence: "high" };
  }

  const domain = canonicalSupplierDomain(url);
  const titleName = cleanName(title.replace(/\s*[|:]\s*.*/u, ""));
  const domainLabel = domain.split(".")[0] ?? "";
  const labeledName = text.match(COMPANY_LABEL)?.[1];
  const officialName = text.match(new RegExp(`(?:^|[^\\p{L}\\p{N}])(${domainLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[^\\p{L}\\p{N}])`, "iu"))?.[1];
  const domainBrand = title.split(/\s*(?:\||[–—]|\s-\s)\s*/u).map(cleanName).find(candidate =>
    validConcreteName(candidate)
      && candidate.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") === domainLabel.replace(/[^\p{L}\p{N}]+/gu, ""));
  const name = labeledName && validConcreteName(labeledName) ? cleanName(labeledName)
    : validConcreteName(titleName) && !PRODUCT_TITLE.test(titleName) ? titleName
      : domainBrand ? domainBrand
      : officialName && validConcreteName(officialName) ? cleanName(officialName)
        : nameFromDomain(domain);
  const fallbackOnly = !labeledName && !(validConcreteName(titleName) && !PRODUCT_TITLE.test(titleName)) && !domainBrand && !officialName;
  if (!domain || !validConcreteName(name) || (fallbackOnly && !/\p{L}/u.test(domainLabel))) return null;
  return { name, domain, officialUrl: url, sourceType, aliases: [...new Set([name, domainLabel])],
    identitySource: labeledName ? "company_label" : "official_domain", confidence: labeledName || domainBrand ? "high" : "medium" };
}

export function supplierIdentityKey(identity: SupplierIdentity): string {
  return identity.domain
    ? `domain:${canonicalSupplierDomain(identity.domain)}`
    : `name:${identity.name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}`;
}
