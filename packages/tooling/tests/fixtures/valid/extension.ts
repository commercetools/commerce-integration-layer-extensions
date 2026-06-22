// A valid extension that imports a sibling helper module. After bundling this is
// one self-contained file; validation must accept it and the resolver must return
// the helper's value (proving the import was inlined, not left dangling).

import { GREETING } from "./greeting.js";

export const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")

  type Query {
    greeting: String!
  }
`;

export const resolvers = {
  Query: {
    greeting: () => GREETING,
  },
};
