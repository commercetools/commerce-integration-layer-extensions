import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Inline the Apollo federation packages so they resolve `graphql` through the alias
    // below (Vite's resolver) rather than their own nested copy.
    server: { deps: { inline: [/@apollo\//] } },
  },
  // Force a SINGLE `graphql` instance across the test graph. @apollo/composition +
  // @apollo/federation-internals + @apollo/subgraph and the tests all import `graphql`;
  // under pnpm's symlinked layout vitest can otherwise load two copies, tripping
  // graphql-js's "Duplicate graphql modules" instanceof guard (e.g. inside printSchema).
  // Aliasing to one resolved path collapses them. The built CLI already has one instance.
  resolve: { alias: { graphql: require.resolve("graphql") }, dedupe: ["graphql"] },
});
