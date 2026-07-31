/**
 * Example extension — the EXTEND-WITH-@requires pattern: a field computed from a
 * value the Commerce Integration Layer owns (`Product.discountedPrice`). Where loyalty-points
 * needed only the entity's key, this field's value depends on a field the integration
 * layer owns — the product's `price` — pulled in with `@requires`.
 *
 * The Commerce Integration Layer exposes `Product` as a Federation entity keyed by `id`.
 * `discountedPrice` needs the product's `price.amount` (a v2 `Money` — a decimal
 * amount STRING plus a currency), so this subgraph declares `price` `@external` and
 * names the nested field in `@requires`; the query planner resolves it on the
 * integration-layer side and hands it to this resolver in the entity representation
 * (no re-entry by key). The key field `id` stays NON-`@external` — marking a key field
 * `@external` stops the planner from satisfying `@requires`. Do NOT redeclare or
 * resolve the Commerce Integration Layer's own fields — `price` is referenced (`@external`),
 * not owned.
 *
 * (There is no standalone `ProductPrice` entity to attach to, so a price-derived field
 * lives on the owning `Product`. `Money` is `{ amount, currencyCode, formatted }` — a
 * decimal amount string, not a `centAmount` integer.)
 *
 * An independent, project-agnostic template. Edit this file, then run `pnpm validate`
 * / `pnpm push` from this directory (the target Project comes from your
 * `commercetools auth login`). Exports `typeDefs` + `resolvers`; runs in a restricted
 * sandbox — see ../../../docs/authoring.md.
 */

export const typeDefs = `
  extend schema @link(
    url: "https://specs.apollo.dev/federation/v2.3"
    import: ["@key", "@requires", "@external"]
  )

  "The Commerce Integration Layer owns Money; this subgraph references only the one field it needs, as @external."
  type Money {
    "Decimal amount as a string, e.g. 89.00 (v2 Money — never a centAmount)."
    amount: String! @external
  }

  "A field this subgraph attaches to a product, computed from the product's own price."
  type Product @key(fields: "id") {
    id: ID!
    "Owned and resolved by the Commerce Integration Layer — pulled in via @requires, never resolved here."
    price: Money @external
    "The price after a percentage off as a decimal string, e.g. percentOff: 10 on \\"275.00\\" → \\"247.50\\". Null when the product has no price."
    discountedPrice(percentOff: Int!): String @requires(fields: "price { amount }")
  }
`;

export const resolvers = {
  Product: {
    // The parent is the entity representation the Commerce Integration Layer resolved —
    // `{ id }` plus the `@requires` field `price { amount }`. The field derives
    // entirely from that and its `percentOff` argument, so it touches neither a host
    // capability nor any network — pure and trivially safe. `price` is nullable
    // (entitlement-gated), so a missing price yields `null` rather than a fabricated
    // amount. `percentOff` is clamped to [0, 100]; the result keeps two decimals.
    discountedPrice: (
      product: { id: string; price: { amount: string } | null },
      { percentOff }: { percentOff: number },
    ): string | null => {
      const amount = product.price?.amount;
      if (amount == null) return null;
      const base = Number(amount);
      if (!Number.isFinite(base)) return null;
      const pct = Math.min(100, Math.max(0, percentOff));
      return ((base * (100 - pct)) / 100).toFixed(2);
    },
  },
};
