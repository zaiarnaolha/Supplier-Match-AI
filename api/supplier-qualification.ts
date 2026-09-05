export type SupplierQualification =
  | {
      qualified: true;
      confidence: "high" | "medium";
      evidence: string[];
    }
  | {
      qualified: false;
      reason: string;
    };

const EDITORIAL_TITLE_SIGNALS: readonly RegExp[] = [
  /(?:^|\W)(?:рейтинг|rating)(?:\W|$)/iu,
  /(?:^|\W)(?:топ|top)\s*[-–—]?\s*\d+/iu,
  /(?:як\s+(?:обрати|вибрати)|how\s+to\s+choose|buyer'?s?\s+guide|гайд|поради)/iu,
  /(?:огляд|review|editorial|редакційн\p{L}*|порівняння|comparison|добірка|підбірка)/iu,
  /(?:що\s+таке|what\s+is|все\s+про)/iu,
];

const EDITORIAL_URL_SIGNALS: readonly RegExp[] = [
  /\/(?:blog|news|articles?|journal|media|guides?|reviews?)(?:\/|$)/iu,
];

const INFORMATIONAL_SIGNALS: readonly RegExp[] = [
  /(?:новини|news)\s+(?:ринку|галузі|компанії)/iu,
  /(?:опубліковано|published)\s+(?:on|by|\d)/iu,
  /(?:автор|author)\s*:/iu,
];

const AGGREGATION_SIGNALS: readonly RegExp[] = [
  /(?:каталог|directory|список|list)\s+(?:компаній|постачальників|виробників|suppliers|manufacturers)/iu,
  /(?:пропозиці(?:й|ї)|offers?)\s+(?:від|from)\s+(?:різних\s+)?(?:продавців|sellers)/iu,
  /(?:порівняти\s+пропозиції|compare\s+offers)/iu,
  /\d+\s+(?:пропозиці(?:й|ї)|offers?|товар(?:ів|и)|products?)/iu,
];

const STRONG_SUPPLIER_SIGNALS: readonly RegExp[] = [
  /(?:ми|наша\s+компанія)\s*(?:—|-|є|це)?\s*(?:українськ\p{L}*\s+)?(?:виробник|постачальник|дистриб['’]?ютор)/iu,
  /(?:ми|наша\s+компанія)\s+(?:виробляємо|постачаємо|дистриб['’]?юємо|продаємо\s+(?:оптом|гуртом))/iu,
  /(?:офіційний|авторизований)\s+(?:постачальник|дистриб['’]?ютор)/iu,
  /(?:оптовий\s+(?:постачальник|магазин)|виробник\s+та\s+постачальник)/iu,
  /(?:we|our\s+company)\s+(?:are\s+|are\s+an?\s+)?(?:manufacturers?|suppliers?|distributors?|wholesalers?)/iu,
  /(?:we|our\s+company)\s+(?:manufacture|supply|distribute|sell\s+wholesale)/iu,
  /(?:official|authorized)\s+(?:supplier|distributor)/iu,
  /(?:wholesale\s+(?:supplier|store)|manufacturer\s+and\s+supplier)/iu,
  /(?:тов|фоп)\s+[\p{L}\p{N}"“”'’ .-]{2,60}\s*(?:—|-)\s*(?:виробник|постачальник|дистриб['’]?ютор)/iu,
];

const BUSINESS_IDENTITY_SIGNALS: readonly RegExp[] = [
  /(?:тов|фоп|llc|ltd\.?|inc\.?|gmbh)(?:\W|$)/iu,
  /(?:наша\s+компанія|our\s+company|про\s+компанію|about\s+(?:us|the\s+company))/iu,
  /(?:контакти|contact\s+us|юридична\s+адреса|legal\s+address)/iu,
  /(?:магазин|shop|store)\s+[\p{L}\p{N}"“”'’ .-]{2,50}/iu,
  /(?:продавець|seller|компанія|company)\s*[:—-]?\s*[\p{L}\p{N}"“”'’& .-]{2,50}/iu,
];

const COMMERCIAL_ACTIVITY_SIGNALS: readonly RegExp[] = [
  /(?:каталог\s+(?:товарів|продукції)|product\s+catalog(?:ue)?|our\s+products)/iu,
  /(?:оптом|гуртом|wholesale|moq|minimum\s+order)/iu,
  /(?:в\s+наявності|in\s+stock|додати\s+у\s+кошик|add\s+to\s+cart|артикул|sku)/iu,
  /(?:ціна|price)\s*[:—-]?\s*(?:від\s+)?(?:[$€₴]\s*)?\d/iu,
  /\d+(?:[.,]\d+)?\s*(?:грн|uah|usd|eur|₴|[$€])(?:\s*\/\s*\p{L}+)?/iu,
];

const B2B_SIGNALS: readonly RegExp[] = [
  /(?:оптом|гуртом|оптов(?:ий|а|і|і ціни?)|wholesale|b2b)/iu,
  /(?:moq|minimum\s+order|мінімальн(?:е\s+замовлення|а\s+партія))/iu,
  /(?:дистриб['’]?ютор|distributors?|виробник|manufacturers?|постачальник|suppliers?)/iu,
  /(?:horeca|business\s+customers?|для\s+(?:кав['’]?ярень|бізнес(?:у|ів)|закладів)|corporate\s+supply|корпоративн(?:і\s+поставки|е\s+постачання))/iu,
];

function matchingEvidence(text: string, patterns: readonly RegExp[]): string[] {
  return patterns.flatMap(pattern => text.match(pattern)?.[0] ?? []).filter((value, index, values) =>
    values.findIndex(candidate => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) === index);
}

function firstMatchingEvidence(text: string, patterns: readonly RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[0];
    if (match) return match;
  }
  return null;
}

function parseUrl(url: string): { hostname: string; pathname: string } {
  try {
    const parsed = new URL(url);
    return {
      hostname: parsed.hostname.toLocaleLowerCase().replace(/^www\./, ""),
      pathname: parsed.pathname.toLocaleLowerCase(),
    };
  } catch {
    return { hostname: "", pathname: "" };
  }
}

function marketplaceAggregation(text: string, hostname: string, pathname: string): boolean {
  if (hostname !== "prom.ua" && !hostname.endsWith(".prom.ua")) return false;

  const aggregationEvidence = firstMatchingEvidence(text, AGGREGATION_SIGNALS);
  const categoryPath = /^\/(?:ua\/)?[^/]+\.html\/?$/iu.test(pathname);
  const searchPath = /\/(?:search|category|categories)(?:\/|$)/iu.test(pathname);

  return Boolean(aggregationEvidence || categoryPath || searchPath);
}

function domainBrandEvidence(text: string, hostname: string): string | null {
  const label = hostname.split(".")[0]?.replace(/[^\p{L}\p{N}]+/gu, "") ?? "";
  if (label.length < 4 || !/\p{L}/u.test(label)) return null;
  const compactText = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return compactText.includes(label.toLocaleLowerCase()) ? label : null;
}

export function qualifySupplierCandidate(
  title: string,
  content: string,
  url: string,
): SupplierQualification {
  const text = `${title}. ${content}`.replace(/\s+/g, " ").trim();
  const { hostname, pathname } = parseUrl(url);

  const b2b = firstMatchingEvidence(text, B2B_SIGNALS);

  const editorialTitle = firstMatchingEvidence(title, EDITORIAL_TITLE_SIGNALS);
  if (editorialTitle && !b2b) {
    return { qualified: false, reason: `editorial title: ${editorialTitle}` };
  }

  const editorialUrl = firstMatchingEvidence(pathname, EDITORIAL_URL_SIGNALS);
  if (editorialUrl && !b2b) {
    return { qualified: false, reason: `editorial URL: ${editorialUrl}` };
  }

  const informational = firstMatchingEvidence(text, INFORMATIONAL_SIGNALS);
  if (informational && !b2b) {
    return { qualified: false, reason: `informational content: ${informational}` };
  }

  const aggregation = firstMatchingEvidence(text, AGGREGATION_SIGNALS);
  if ((aggregation || marketplaceAggregation(text, hostname, pathname)) && !b2b) {
    return { qualified: false, reason: `aggregation page: ${aggregation ?? hostname}` };
  }

  const strongSupplier = firstMatchingEvidence(text, STRONG_SUPPLIER_SIGNALS);
  if (strongSupplier && b2b) {
    return { qualified: true, confidence: "high", evidence: [...new Set([strongSupplier, b2b])] };
  }

  const businessIdentity = firstMatchingEvidence(text, BUSINESS_IDENTITY_SIGNALS);
  const commercialActivity = firstMatchingEvidence(text, COMMERCIAL_ACTIVITY_SIGNALS);
  if (businessIdentity && commercialActivity && b2b) {
    return {
      qualified: true,
      confidence: "medium",
      evidence: [...new Set([businessIdentity, commercialActivity, b2b])],
    };
  }

  // Two independent, supplier-specific B2B claims are strong enough on a concrete
  // commercial page, while a lone wholesale keyword remains insufficient.
  const b2bEvidence = matchingEvidence(text, B2B_SIGNALS);
  if (b2bEvidence.length >= 2 && !editorialTitle && !editorialUrl && !informational && !aggregation
    && !marketplaceAggregation(text, hostname, pathname)) {
    return { qualified: true, confidence: "high", evidence: b2bEvidence };
  }

  // An official site's stable brand text matching its registrable domain is
  // concrete business identity evidence when paired with explicit B2B activity.
  const domainBrand = domainBrandEvidence(text, hostname);
  if (domainBrand && commercialActivity && b2b) {
    return { qualified: true, confidence: "medium", evidence: [...new Set([domainBrand, commercialActivity, b2b])] };
  }

  return { qualified: false, reason: "insufficient concrete supplier evidence" };
}
