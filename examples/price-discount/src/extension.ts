/**
 * Example extension — the EXTEND-WITH-@requires pattern: a field on a nested object
 * computed from that object's OWN data (`ProductPrice.discountedAmount`). Where
 * loyalty-points needed only the entity's key, this field's value depends on a field
 * the integration layer owns, pulled in with `@requires`.
 *
 * The integration layer exposes `ProductPrice` (a variant's price entries) as a
 * Federation entity keyed by `id`. `discountedAmount` needs the price's
 * `value.centAmount`, so this subgraph declares that field `@external` and names it in
 * `@requires`; the query planner resolves it on the integration-layer side and hands
 * it to this resolver in the entity representation (no re-entry by key). Do NOT
 * redeclare or resolve the integration layer's own fields — `value` is referenced
 * (`@external`), not owned.
 *
 * An independent, project-agnostic template. Edit this file, then run `pnpm validate`
 * / `pnpm push` from this directory (the target project comes from the shared `.env`).
 * Exports `typeDefs` + `resolvers`; runs in a restricted runtime — see the README's
 * "Authoring constraints".
 */

export const typeDefs = `
  extend schema @link(
    url: "https://specs.apollo.dev/federation/v2.3"
    import: ["@key", "@requires", "@external"]
  )

  "The integration layer owns Money; this subgraph references only the one field it needs, as @external."
  type Money {
    centAmount: Int! @external
  }

  "A field this subgraph attaches to a product's price, computed from the price's own value."
  type ProductPrice @key(fields: "id") {
    id: ID!
    "Owned and resolved by the integration layer — pulled in via @requires, never resolved here."
    value: Money! @external
    "The price in minor units after a percentage off, e.g. percentOff: 10 on 27500 → 24750."
    discountedAmount(percentOff: Int!): Int! @requires(fields: "value { centAmount }")
  }
`;

export const resolvers = {
  ProductPrice: {
    // The parent is the entity representation the integration layer resolved —
    // `{ id }` plus the `@requires` field `value { centAmount }`. The field derives
    // entirely from that and its `percentOff` argument, so it touches neither a host
    // capability nor any network — pure and trivially safe. Clamp percentOff to [0, 100] and round
    // to whole minor units (cents) so the result is always a sane integer price.
    discountedAmount: (
      price: { id: string; value: { centAmount: number } },
      { percentOff }: { percentOff: number },
    ): number => {
      const pct = Math.min(100, Math.max(0, percentOff));
      return Math.round((price.value.centAmount * (100 - pct)) / 100);
    },
  },
};
