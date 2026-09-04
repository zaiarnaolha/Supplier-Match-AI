export const supplierEnrichmentSnippets = {
  confirmed: [
    {
      title: "Whole bean coffee catalog",
      url: "https://coffee.example/catalog",
      content: "Our company is based in Lviv, Ukraine. MOQ: 20 kg. Wholesale price $10/kg. We deliver to Poland.",
    },
  ],
  unavailable: [
    {
      title: "Shipping information",
      url: "https://coffee.example/shipping",
      content: "We do not ship to Poland. Contact our office for other destinations.",
    },
  ],
  geographyOnly: [
    {
      title: "Coffee from Poland",
      url: "https://coffee.example/catalog",
      content: "Popular throughout Poland. Our beans are imported from Colombia.",
    },
  ],
} as const;
