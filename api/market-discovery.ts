const MARKETS: Record<string, { language: string; commercialTerms: string }> = {
  ukraine: { language: "Ukrainian", commercialTerms: "оптом гуртом постачальник виробник дистриб'ютор мінімальне замовлення доставка" },
  "україна": { language: "Ukrainian", commercialTerms: "оптом гуртом постачальник виробник дистриб'ютор мінімальне замовлення доставка" },
  poland: { language: "Polish", commercialTerms: "hurtowo dostawca producent dystrybutor minimalne zamówienie dostawa" },
  "польща": { language: "Polish", commercialTerms: "hurtowo dostawca producent dystrybutor minimalne zamówienie dostawa" },
  germany: { language: "German", commercialTerms: "Großhandel Lieferant Hersteller Distributor Mindestbestellmenge Lieferung" },
  "німеччина": { language: "German", commercialTerms: "Großhandel Lieferant Hersteller Distributor Mindestbestellmenge Lieferung" },
};

export function buildMarketAwareDiscoveryQuery(product: string, deliveryRegion: string): string {
  const market = MARKETS[deliveryRegion.trim().toLocaleLowerCase()];
  const marketInstruction = market
    ? `Use ${market.language} market terminology: ${market.commercialTerms}.`
    : `Use the local commercial terminology used by buyers in ${deliveryRegion}.`;
  return [
    product,
    marketInstruction,
    `Find suppliers that can deliver to ${deliveryRegion}; supplier location may be any country.`,
    "Find actual manufacturers, distributors, wholesalers, and supplier-specific marketplace listings.",
    "Discovery pages are sources only: identify the concrete seller/company and prefer its official website.",
  ].join(" ");
}

export function buildAdditionalMarketAwareDiscoveryQuery(product: string, deliveryRegion: string): string {
  const market = MARKETS[deliveryRegion.trim().toLocaleLowerCase()];
  const marketInstruction = market
    ? `Use ${market.language} market terminology: ${market.commercialTerms}.`
    : `Use the local commercial terminology used by buyers in ${deliveryRegion}.`;
  return [
    product,
    marketInstruction,
    `Find B2B catalogues, HoReCa partners, importers, and corporate supply offers that deliver to ${deliveryRegion}; supplier location may be any country.`,
    "Use a different commercial intent from the primary search: focus on trade accounts, bulk purchasing, and minimum-order offers.",
    "Return concrete manufacturers, distributors, wholesalers, or named sellers; discovery pages remain evidence sources only.",
  ].join(" ");
}

export function buildComplementaryMarketAwareDiscoveryQuery(product: string, deliveryRegion: string): string {
  const market = MARKETS[deliveryRegion.trim().toLocaleLowerCase()];
  const marketInstruction = market
    ? `Use ${market.language} market terminology: ${market.commercialTerms}.`
    : `Use the local commercial terminology used by buyers in ${deliveryRegion}.`;
  return [
    product,
    marketInstruction,
    `Find product-specific manufacturers, producers, distributors, HoReCa suppliers, wholesale catalogues, and B2B product pages that deliver to ${deliveryRegion}; supplier location may be any country.`,
    "Use a complementary commercial intent from the earlier searches and identify concrete supplier companies or named B2B sellers.",
    "Marketplaces, directories, catalogues, and articles are evidence sources only and must not themselves become suppliers.",
  ].join(" ");
}
