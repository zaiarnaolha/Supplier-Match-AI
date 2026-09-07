export interface SupplierSearchCriteria {
  product: string | null;
  deliveryRegion: string;
}

const REGION_VALUES: Readonly<Record<string, string>> = {
  ukraine: "Україна",
  europe: "Європа",
  asia: "Азія",
  anywhere: "Будь-яка країна",
};

function extractProductCriterion(query: string): string | null {
  if (/(?:whole bean coffee|кава в зернах|кави в зернах|зернова кава|зернової кави|coffee beans)/iu.test(query)) {
    return "Кава в зернах";
  }
  return null;
}

function extractDeliveryRegionCriterion(query: string): string {
  if (/(?:доставк\p{L}*|поставк\p{L}*|постачальник\p{L}*|deliver\p{L}*|ship\p{L}*|suppl\p{L}*)[^.!?]{0,80}(?:в|до|to|throughout)\s+(?:україн(?:а|у|і)|ukraine)(?=$|[^\p{L}\p{N}])/iu.test(query)
    || /(?:в|до|to)\s+(?:україн(?:а|у|і)|ukraine)(?=$|[^\p{L}\p{N}])[^.!?]{0,80}(?:доставк\p{L}*|поставк\p{L}*|постачальник\p{L}*|deliver\p{L}*|ship\p{L}*|suppl\p{L}*)/iu.test(query)) {
    return "Україна";
  }
  return "";
}

export function normalizeDeliveryRegion(value: string): string {
  const trimmed = value.trim();
  return REGION_VALUES[trimmed.toLocaleLowerCase()] ?? trimmed;
}

export function deriveSupplierSearchCriteria(query: string, selectedDeliveryRegion = ""): SupplierSearchCriteria {
  return {
    product: extractProductCriterion(query),
    deliveryRegion: normalizeDeliveryRegion(selectedDeliveryRegion) || extractDeliveryRegionCriterion(query),
  };
}

export function buildSupplierSearchRequest(query: string, selectedDeliveryRegion = "") {
  const normalizedQuery = query.trim();
  const criteria = deriveSupplierSearchCriteria(normalizedQuery, selectedDeliveryRegion);
  return { query: normalizedQuery, deliveryRegion: criteria.deliveryRegion, criteria };
}
