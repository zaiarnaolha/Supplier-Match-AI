import assert from "node:assert/strict";
import test from "node:test";
import { resolveSupplierDisplayName } from "../api/supplier-display-name.ts";
import { asDiscoveryEvidence, resolveSupplierIdentities } from "../api/supplier-discovery.ts";

const evidence = (items: Array<{ title: string; content: string; url: string; score?: number }>) => asDiscoveryEvidence(
  items.map(item => ({ ...item, score: item.score ?? 0.8 })), "primary",
);

test("generic coffee identity uses its canonical domain as a non-company presentation fallback", () => {
  const resolved = resolveSupplierIdentities(evidence([{
    title: "Coffee", content: "Our company supplies coffee wholesale to B2B customers.", url: "https://coffee.example/wholesale",
  }]));
  assert.equal(resolved.suppliers.length, 1);
  const supplier = resolved.suppliers[0];
  const keysBefore = [...supplier.equivalenceKeys];
  assert.equal(resolveSupplierDisplayName(supplier.identity, supplier.evidence), "coffee.example");
  assert.equal(supplier.identity.name, "Coffee");
  assert.deepEqual(supplier.equivalenceKeys, keysBefore);
});

test("canonical official company label replaces weak Euro presentation without changing identity equivalence", () => {
  const resolved = resolveSupplierIdentities(evidence([
    { title: "Euro", content: "Euro company supplies coffee wholesale to B2B customers.", url: "https://euro.example/wholesale" },
    { title: "Wholesale", content: "Company: Euro Roasters GmbH. Coffee supplier for wholesale B2B customers.", url: "https://euro.example/about" },
  ]));
  assert.equal(resolved.suppliers.length, 1);
  const supplier = resolved.suppliers[0];
  const keysBefore = [...supplier.equivalenceKeys];
  assert.equal(resolveSupplierDisplayName(supplier.identity, supplier.evidence), "Euro Roasters GmbH");
  assert.deepEqual(supplier.equivalenceKeys, keysBefore);
});

test("evidenced Leader Coffee formatting wins deterministically, but is never invented", () => {
  const compact = { title: "LEADERCOFFEE", content: "Company supplies coffee wholesale to B2B customers.", url: "https://leadercoffee.example/wholesale" };
  const formatted = { title: "Leader Coffee | Wholesale", content: "Leader Coffee supplies coffee wholesale to B2B customers.", url: "https://leadercoffee.example/about" };
  const onlyCompact = resolveSupplierIdentities(evidence([compact])).suppliers[0];
  assert.equal(resolveSupplierDisplayName(onlyCompact.identity, onlyCompact.evidence), "LEADERCOFFEE");

  for (const ordered of [[compact, formatted], [formatted, compact]]) {
    const supplier = resolveSupplierIdentities(evidence(ordered)).suppliers[0];
    assert.equal(resolveSupplierDisplayName(supplier.identity, supplier.evidence), "Leader Coffee");
  }
});

test("unrelated external labels cannot rename a supplier and international spelling is preserved", () => {
  const supplier = resolveSupplierIdentities(evidence([{
    title: "Caffè Europa", content: "Caffè Europa company is a coffee wholesale supplier for B2B customers.", url: "https://caffeeuropa.example/wholesale",
  }])).suppliers[0];
  const withUnrelated = [...supplier.evidence, ...evidence([{
    title: "Supplier profile", content: "Company: Similar Europa Group. Coffee wholesale supplier for B2B.", url: "https://directory.example/similar",
  }])];
  assert.equal(resolveSupplierDisplayName(supplier.identity, withUnrelated), "Caffè Europa");
});
