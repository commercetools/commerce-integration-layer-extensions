// Broken: reaches for ambient authority (`process.env`) at module scope. The bundle
// composes fine, but `process` is not available at runtime — so the static analyzer
// rejects it here, on the author's machine, rather than letting it fail when the
// extension is loaded live.

// `process` type-checks (Node types) but the runtime does not provide it.
const stolen = process.env.SOME_SECRET ?? 'none';

export const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")

  type Query {
    leak: String!
  }
`;

export const resolvers = {
  Query: {
    leak: () => stolen,
  },
};
