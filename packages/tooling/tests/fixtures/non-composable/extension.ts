// Broken: parses as GraphQL, but a field references a type the SDL never defines,
// so the SDL can't build into a schema. Validation must reject it when it builds
// the schema for the coherence check (the remote compose would reject it too).

export const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")

  type Query {
    widget: Widget!
  }
`;

export const resolvers = {
  Query: {
    widget: () => ({}),
  },
};
