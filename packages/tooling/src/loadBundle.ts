// Load a built extension bundle and return its exported `typeDefs` + `resolvers`,
// used by the resolver-coherence check and the local dev server.
//
// The bundle is esbuild's single-file CommonJS artifact, so we evaluate it with the
// CommonJS calling convention and a `require` that resolves only `graphql` (a second
// copy would break `instanceof`). It runs as an ordinary module — not a security
// boundary; the runtime enforces that, and `staticAnalysis.ts` screens the source first.

import { GraphQLError } from "graphql";

export interface EvaluatedBundle {
  typeDefs?: unknown;
  resolvers?: unknown;
  // commercetools API-Extension handlers (a bundle may export these instead of, or
  // alongside, a GraphQL subgraph). See apiExtension.ts.
  apiExtensions?: unknown;
}

/**
 * Evaluate an esbuild-CJS extension bundle and return its `module.exports`.
 * `require` resolves only `graphql`; any other module id throws.
 */
export function loadBundleSource(source: string): EvaluatedBundle {
  const moduleObject: { exports: EvaluatedBundle } = { exports: {} };
  const requireShim = (id: string): unknown => {
    if (id === "graphql") return { GraphQLError };
    throw new Error(`extension bundle may not require "${id}"`);
  };
  // The CommonJS wrapper: bind `module`/`exports`/`require` and run the source.
  const evaluate = new Function("module", "exports", "require", source);
  evaluate(moduleObject, moduleObject.exports, requireShim);
  return moduleObject.exports;
}
