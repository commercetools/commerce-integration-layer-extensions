/**
 * Example extension — the EXTEND-AN-ENTITY pattern: a new field on an existing entity
 * (`Product.loyaltyPoints`). In the v2 contract `Product` is a single CONCRETE object
 * entity (there is no interface + concrete-subtype model any more), so
 * `type Product @key(fields: "id") { id: ID! <newField> }` attaches a field to every
 * product by its `id`. The key field `id` is declared NORMALLY (not `@external`) — it
 * is the entity key the router routes on; only fields OWNED by another subgraph get
 * `@external`. `loyaltyPoints` is computed purely from its argument, so it needs
 * nothing from the product but its identity (no entity fetch). Do NOT redeclare fields
 * the Commerce Integration Layer owns — co-owning needs `@shareable`.
 *
 * An independent, project-agnostic template. Edit this file, then run `pnpm validate`
 * / `pnpm push` from this directory (the target Project comes from your
 * `commercetools auth login`). Exports `typeDefs` + `resolvers`; runs in a restricted
 * sandbox — see ../../../docs/authoring.md.
 */

export const typeDefs = `
  extend schema @link(
    url: "https://specs.apollo.dev/federation/v2.3"
    import: ["@key"]
  )

  "A field this subgraph attaches to every product, keyed by the product's id."
  type Product @key(fields: "id") {
    id: ID!
    "Loyalty points earned for a price: 1 per whole currency unit. The storefront passes the price it already holds from the catalog/variant."
    loyaltyPoints(price: Float!): Int!
  }
`;

export const resolvers = {
  Product: {
    // `_product` is the entity representation the Commerce Integration Layer resolved
    // (`{ id }`); this field derives entirely from its `price` argument, so it
    // touches neither the product nor any host capability — pure and trivially safe.
    loyaltyPoints: (_product: { id: string }, { price }: { price: number }) =>
      Math.floor(price),
  },
};
