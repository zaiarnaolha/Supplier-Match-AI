export type DiscoverySourceType = "official" | "marketplace" | "directory" | "article" | "external";

export interface SupplierIdentity {
  name: string;
  domain: string | null;
  officialUrl: string | null;
  sourceType: DiscoverySourceType;
}

const MARKETPLACES = ["prom.ua", "rozetka.com.ua", "agrotorg.net", "agrotorg.com", "alibaba.com", "amazon.com", "etsy.com"];
const DIRECTORY_HOSTS = ["all.biz", "europages.com", "kompass.com"];
const PLATFORM_NAMES = /^(?:prom(?:\.ua)?|agrotorg|alibaba|amazon|etsy|all\.biz|europages|kompass)$/iu;
const GENERIC_SUPPLIER_NAME = /^(?:(?:виробник|постачальник|продавець|дистриб['’]?ютор|manufacturer|supplier|seller|distributor)|(?:кава|coffee|чай|tea)(?:\s+в\s+зернах|\s+beans?)?(?:\s+(?:оптом|гуртом|wholesale))?|(?:продаж|купити|каталог|category|products?)(?:\s+.+)?|(?:продукт(?:и|ы)\s+питани[яє]|напитки)(?:\s+.+)?|зелена\s+кава(?:\s+.+)?)$/iu;
const SELLER_LABEL = /(?:продавець|постачальник|компанія|виробник|seller|supplier|sold\s+by|company|manufacturer)\s*[:—-]\s*([\p{L}\p{N}][\p{L}\p{N}&'’"“” _-]{1,70})/iu;
const OFFICIAL_SITE = /(?:офіційний\s+сайт|сайт\s+(?:компанії|продавця)|official\s+(?:web)?site|company\s+(?:web)?site)\s*[:—-]?\s*(https?:\/\/[^\s,;)]+|(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s,;)]*)?)/iu;
const PRODUCT_TITLE = /(?:кава|coffee|чай|tea|купити|ціна|price|catalog|каталог|товар|product)/iu;

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
  if (/\/(?:blog|news|articles?|guides?|reviews?)(?:\/|$)/iu.test(pathname)) return "article";
  return "official";
}

function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s+[|–—]\s+.*$/u, "").replace(/[.,;:]$/u, "").trim();
}

export function isConcreteSupplierName(value: string): boolean {
  const name = cleanName(value).replace(/^["“”'’]+|["“”'’]+$/gu, "").trim();
  return name.length >= 2 && !PLATFORM_NAMES.test(name) && !GENERIC_SUPPLIER_NAME.test(name);
}

function compact(value: string): string {
  return value.toLocaleLowerCase().replace(/^www\./, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

function domainBrand(text: string, domain: string): string | null {
  const label = domain.split(".")[0] ?? "";
  const target = compact(label);
  if (target.length < 3) return null;
  const words = text.match(/!?[\p{L}\p{N}][\p{L}\p{N}'’!-]*/gu) ?? [];
  for (let size = Math.min(5, words.length); size >= 1; size -= 1) {
    for (let index = 0; index + size <= words.length; index += 1) {
      const candidate = cleanName(words.slice(index, index + size).join(" "));
      if (compact(candidate) === target && isConcreteSupplierName(candidate)) return candidate;
    }
  }
  return null;
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
    if (!isConcreteSupplierName(name)) return null;
    const officialMention = text.match(OFFICIAL_SITE)?.[1] ?? null;
    const officialUrl = officialMention ? urlFromMention(officialMention) : null;
    const domain = officialUrl ? canonicalSupplierDomain(officialUrl) : null;
    if (domain && MARKETPLACES.includes(domain)) return null;
    return { name, domain, officialUrl, sourceType };
  }

  const domain = canonicalSupplierDomain(url);
  const titleName = cleanName(title.replace(/\s*[|:]\s*.*/u, ""));
  const domainLabel = domain.split(".")[0] ?? "";
  const recoveredBrand = domainBrand(text, domain);
  const titleIsPageHeading = PRODUCT_TITLE.test(titleName) || GENERIC_SUPPLIER_NAME.test(titleName);
  const domainDisplay = domainLabel.split(/[-_]+/u).filter(Boolean)
    .map(part => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`).join(" ");
  const name = recoveredBrand ?? (!titleIsPageHeading && isConcreteSupplierName(titleName) ? titleName : domainDisplay);
  if (!domain || !isConcreteSupplierName(name)) return null;
  return { name, domain, officialUrl: url, sourceType };
}

export function supplierIdentityKey(identity: SupplierIdentity): string {
  return identity.domain
    ? `domain:${canonicalSupplierDomain(identity.domain)}`
    : `name:${identity.name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}`;
}
