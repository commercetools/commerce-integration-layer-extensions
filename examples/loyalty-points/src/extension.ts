/**
 * Example extension — the EXTEND-AN-ENTITY pattern: a new field on an existing entity
 * (`Product.loyaltyPoints`). The integration layer exposes `Product` as a Federation
 * entity interface (`@key(fields: "id")`), so `@interfaceObject` attaches a field to
 * *every* product by its `id`, without enumerating the concrete per-product-type
 * objects. `loyaltyPoints` is computed purely from its argument, so it needs nothing
 * from the product but its identity (no entity fetch). Do NOT redeclare fields the
 * integration layer owns — co-owning needs `@shareable`.
 *
 * An independent, project-agnostic template. Edit this file, then run `pnpm validate`
 * / `pnpm push` from this directory (the target project comes from the shared `.env`).
 * Exports `typeDefs` + `resolvers`; runs in a restricted runtime — see the README's
 * "Authoring constraints".
 */

export const typeDefs = `
  extend schema @link(
    url: "https://specs.apollo.dev/federation/v2.3"
    import: ["@key", "@interfaceObject"]
  )

  "A field this subgraph attaches to every product, via @interfaceObject."
  type Product @key(fields: "id") @interfaceObject {
    id: ID!
    "Loyalty points earned for a price: 1 per whole currency unit. The storefront passes the price it already holds from the catalog/variant."
    loyaltyPoints(price: Float!): Int!
  }
`;

export const resolvers = {
  Product: {
    // `_product` is the entity representation the integration layer resolved
    // (`{ id }`); this field derives entirely from its `price` argument, so it
    // touches neither the product nor any host capability — pure and trivially safe.
    loyaltyPoints: (_product: { id: string }, { price }: { price: number }) =>
      Math.floor(price),
  },
};
