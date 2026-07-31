/**
 * Example extension — the PURELY ADDITIVE pattern: a brand-new type + root field
 * (`Query.serverTime`). It shares nothing with the integration layer, so the two
 * `Query` types merge with no change to it; composition is trivial.
 *
 * An independent, project-agnostic template. Edit this file, then run `pnpm validate`
 * / `pnpm push` from this directory (the target Project comes from your
 * `commercetools auth login`). An extension exports `typeDefs` (a federation-v2 SDL
 * string) + `resolvers` and runs in a restricted sandbox — see ../../../docs/authoring.md.
 */

export const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")

  type Query {
    "The current wallclock time of the extensions service."
    serverTime: ServerTime!
  }

  "A server clock reading, contributed entirely by the extensions subgraph."
  type ServerTime {
    "ISO-8601 timestamp (UTC)."
    iso: String!
    "Milliseconds since the Unix epoch."
    epochMillis: Float!
    "The timezone the reading is expressed in."
    timezone: String!
  }
`;

export const resolvers = {
  Query: {
    // `ctx.now()` is a convenience for the current epoch-millis (`Date.now()` works
    // too). `new Date(ms)` formats it into an ISO string.
    serverTime: (_parent: unknown, _args: unknown, ctx: { now(): number }) => {
      const epochMillis = ctx.now();
      return {
        iso: new Date(epochMillis).toISOString(),
        epochMillis,
        timezone: 'UTC',
      };
    },
  },
};
