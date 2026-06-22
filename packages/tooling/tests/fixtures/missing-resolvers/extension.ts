// Broken: exports `typeDefs` but no `resolvers`. Validation must reject it.

export const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")

  type Query {
    greeting: String!
  }
`;
