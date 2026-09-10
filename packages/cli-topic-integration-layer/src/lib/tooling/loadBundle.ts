// Load a built extension bundle and return its exported `typeDefs` + `resolvers`,
// used by the resolver-coherence check and the local dev server.
//
// The bundle is esbuild's single-file
// CommonJS artifact, so we evaluate it with the CommonJS calling convention and a
// `require` that resolves `graphql` (a second copy would break `instanceof`) plus
// `http`/`https` — the latter to the gated shim (nodeHttpShim.ts), never Node's
// real modules, so a bundle that imports `https` behaves the same locally as in the
// deployed sandbox. It runs as an ordinary module — not a security boundary; the
// runtime enforces that, and `staticAnalysis.ts` screens the source first.

import { GraphQLError } from "graphql";

import { createNodeHttpShims } from "./nodeHttpShim.js";

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
  // Late-bound fetch: when a resolver runs under the dev server it is the delegating
  // gated fetch (sandboxFetch.ts); elsewhere (coherence check) resolvers don't run.
  const httpShims = createNodeHttpShims((input, init) => globalThis.fetch(input, init));
  const requireShim = (id: string): unknown => {
    if (id === "graphql") return { GraphQLError };
    if (id === "https" || id === "node:https") return httpShims.https;
    if (id === "http" || id === "node:http") return httpShims.http;
    throw new Error(`extension bundle may not require "${id}"`);
  };
  // The CommonJS wrapper: bind `module`/`exports`/`require` and run the source.
  const evaluate = new Function("module", "exports", "require", source);
  evaluate(moduleObject, moduleObject.exports, requireShim);
  return moduleObject.exports;
}
