import { extractMoq, extractPrice, extractProduct, type ExtractedField } from "./supplier-extraction";

export type DeliveryStatus = "confirmed" | "not_confirmed" | "not_available";

export interface SupplierEnrichment {
  product: string | null;
  moq: string | null;
  price: string | null;
  supplierLocation: string | null;
  delivery: {
    region: string | null;
    status: DeliveryStatus;
    evidence: string | null;
  };
}

export interface EnrichmentSnippet {
  title: string;
  url: string;
  content: string;
}

const LOCATION_PATTERNS: readonly RegExp[] = [
  /(?:company|manufacturer|supplier|distributor|headquarters?|office|factory|warehouse|legal address|contact address|based|located)\s+(?:is\s+)?(?:in|at)?\s*[:,-]?\s*([^.!?;]{2,80})/iu,
  /(?:компані\p{L}*|виробник|постачальник|дистриб['’]?ютор|головн\p{L}*\s+офіс|офіс|фабрика|склад|юридична адреса|контактна адреса|базується|розташован\p{L}*)\s*(?:у|в|за адресою)?\s*[:,-]?\s*([^.!?;]{2,80})/iu,
];
const DELIVERY_WORDS = /(?:deliver(?:y|ies|ed)?|ship(?:ping|s|ped)?|достав(?:ка|ляємо|ляє|ити|ки|ку)|відправляємо|відправка)/iu;
const NEGATIVE_DELIVERY = /(?:do(?:es)?\s+not|don['’]?t|cannot|can['’]?t|not\s+available|unavailable|не\s+(?:доставляємо|доставляє|відправляємо)|доставка\s+(?:не\s+здійснюється|недоступна))/iu;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueValue(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  const distinct = new Map(present.map(value => [value.toLocaleLowerCase(), value]));
  return distinct.size === 1 ? [...distinct.values()][0] : null;
}

function fieldValue(field: ExtractedField): string | null {
  return field?.value ?? null;
}

export function extractSupplierLocation(snippets: readonly EnrichmentSnippet[]): string | null {
  const locations: string[] = [];
  for (const snippet of snippets) {
    const text = compact(`${snippet.title}. ${snippet.content}`);
    for (const pattern of LOCATION_PATTERNS) {
      const match = text.match(pattern);
      if (!match) continue;
      const location = compact(match[1]).replace(/^[,:-]\s*/, "").replace(/^based\s+in\s+/iu, "").replace(/\s+(?:and|та)\s+(?:we|ми)\b.*$/iu, "");
      if (location && !DELIVERY_WORDS.test(match[0])) locations.push(location);
      break;
    }
  }
  return uniqueValue(locations);
}

function regionEvidence(text: string, region: string): string[] {
  if (!region) return [];
  const escaped = region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regionPattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu");
  return text.split(/(?<=[.!?])\s+|\n+/u).map(compact).filter(sentence => regionPattern.test(sentence) && DELIVERY_WORDS.test(sentence));
}

export function extractDelivery(snippets: readonly EnrichmentSnippet[], deliveryRegion: string): SupplierEnrichment["delivery"] {
  const region = deliveryRegion.trim() || null;
  if (!region) return { region: null, status: "not_confirmed", evidence: null };

  const evidence = snippets.flatMap(snippet => regionEvidence(`${snippet.title}. ${snippet.content}`, region));
  const negative = evidence.filter(item => NEGATIVE_DELIVERY.test(item));
  const positive = evidence.filter(item => !NEGATIVE_DELIVERY.test(item));
  if (negative.length > 0 && positive.length === 0) return { region, status: "not_available", evidence: negative[0] };
  if (positive.length > 0 && negative.length === 0) return { region, status: "confirmed", evidence: positive[0] };
  return { region, status: "not_confirmed", evidence: null };
}

export function extractEnrichment(snippets: readonly EnrichmentSnippet[], deliveryRegion: string): SupplierEnrichment {
  const products = snippets.map(item => fieldValue(extractProduct(item.title, item.content, item.url)));
  const moqs = snippets.map(item => fieldValue(extractMoq(item.title, item.content)));
  const prices = snippets.map(item => {
    const product = extractProduct(item.title, item.content, item.url);
    return fieldValue(extractPrice(item.title, item.content, product, item.url));
  });
  return {
    product: uniqueValue(products),
    moq: uniqueValue(moqs),
    price: uniqueValue(prices),
    supplierLocation: extractSupplierLocation(snippets),
    delivery: extractDelivery(snippets, deliveryRegion),
  };
}

export function buildEnrichmentQuery(hostname: string, productQuery: string, deliveryRegion: string): string {
  return [
    `site:${hostname}`,
    productQuery,
    "product catalog",
    "MOQ minimum order",
    "exact wholesale price",
    deliveryRegion && `delivery shipping ${deliveryRegion}`,
    "company location address",
  ].filter(Boolean).join(" ");
}
