// Broken: `typeDefs` is not parseable GraphQL SDL (missing closing brace).
// Validation must reject it at the parse step.

export const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")

  type Query {
    greeting: String!
`;

export const resolvers = {
  Query: {
    greeting: () => "hi",
  },
};
