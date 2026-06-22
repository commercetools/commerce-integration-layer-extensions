// Broken: SDL is valid and composable, but a resolver names a field the SDL does
// not declare (`greetng` vs `greeting`). Without the coherence check this is a
// silent runtime no-op; validation must reject it.

export const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")

  type Query {
    greeting: String!
  }
`;

export const resolvers = {
  Query: {
    greetng: () => "typo",
  },
};
