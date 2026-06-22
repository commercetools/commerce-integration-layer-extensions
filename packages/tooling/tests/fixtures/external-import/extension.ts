// A valid extension whose resolver imports from `graphql` (a host-provided
// external). Validation must accept it, and the bundle must NOT inline graphql —
// the import has to stay a bare `from "graphql"` specifier so the host's single
// graphql-js instance is used (two copies break `instanceof` checks).

import { GraphQLError } from "graphql";

export const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")

  type Query {
    boom: String!
  }
`;

export const resolvers = {
  Query: {
    boom: () => {
      throw new GraphQLError("kaboom");
    },
  },
};
