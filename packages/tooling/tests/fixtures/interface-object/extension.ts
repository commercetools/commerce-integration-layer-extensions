// A valid extension that attaches a field to an existing entity via `@interfaceObject`.
// Composition against the live integration layer is the remote check's job; this
// fixture proves it passes the local checks (static analysis + load + coherence).

export const typeDefs = `
  extend schema @link(
    url: "https://specs.apollo.dev/federation/v2.3"
    import: ["@key", "@interfaceObject"]
  )

  type Product @key(fields: "id") @interfaceObject {
    id: ID!
    discountedPrice(rate: Float!): Float!
  }
`;

export const resolvers = {
  Product: {
    discountedPrice: (_product: { id: string }, { rate }: { rate: number }) =>
      Math.max(0, 1 - rate),
  },
};
