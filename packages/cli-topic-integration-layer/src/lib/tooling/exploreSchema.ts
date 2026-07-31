// The schema the local explorer renders — resolved one of two ways.
//
//   default      compose locally: the project's core-subgraph SDL (GET /subgraph)
//                plus, when the working directory holds one, your LOCAL extension.
//                Fast inner loop: edit the extension, restart, see your fields.
//
//   --deployed   the project's DEPLOYED composed graph (GET /schema/api), read from
//                Hive by the Commerce Integration Layer and reduced THERE to a public API
//                schema — exactly what the router plans and serves, including
//                whichever extension is actually deployed. The command just
//                buildSchema()s it, so nothing in this module handles that path.
//
// Only the LOCAL path composes, which is why this module exists at all: a supergraph
// can't be composed on the server for a working-tree extension that was never pushed.
// Both paths end at a client-facing `GraphQLSchema`, which the explorer serves to
// GraphiQL (answering introspection locally). Execution is proxied to the real edge
// either way — this schema drives the docs pane, autocomplete, and validation only.

import { printSchema, type GraphQLSchema } from "graphql";
import { composeServices } from "@apollo/composition";
import { parse } from "graphql";
import {
  composeWithIntegrationLayer,
  INTEGRATION_LAYER_SERVICE,
  type ComposeResult,
} from "./compose.js";

/** Placeholder URLs baked into a locally-composed supergraph. The explorer never
 *  routes through them (it proxies whole operations to the edge), so they are
 *  cosmetic — but composition requires each subgraph to declare one. */
const LOCAL_IL_URL = "http://integration-layer.local/graphql";
const LOCAL_EXTENSION_URL = "http://extension.local/graphql";

/** A resolved explorer schema plus how it was obtained (for the startup banner). */
export interface ExplorerSchema {
  schema: GraphQLSchema;
  sdl: string;
  /** e.g. `local compose (core + your extension)` or `deployed (Hive)`. */
  describe: string;
}

/**
 * Compose the core subgraph ALONE into an API schema — the local path when the
 * working directory has no extension. `composeWithIntegrationLayer` takes two
 * subgraphs, so the single-subgraph case goes straight to `composeServices`.
 */
function composeCoreOnly(coreSdl: string): ComposeResult {
  let services;
  try {
    services = [
      { name: INTEGRATION_LAYER_SERVICE, typeDefs: parse(coreSdl), url: LOCAL_IL_URL },
    ];
  } catch (err) {
    return { ok: false, errors: [`core-subgraph SDL is not valid GraphQL: ${(err as Error).message}`] };
  }
  const result = composeServices(services);
  if (result.errors) return { ok: false, errors: result.errors.map((e) => e.message) };
  const apiSchema = result.schema.toAPISchema().toGraphQLJSSchema();
  return {
    ok: true,
    apiSchema,
    apiSdl: printSchema(apiSchema),
    supergraphSdl: result.supergraphSdl,
  };
}

/**
 * The local-composition path: the project's core subgraph, plus `extensionSdl` when
 * the caller found a local extension to build. Throws with the composition errors
 * when the two don't compose — the same failure `extension validate` reports, and a
 * real answer rather than a half-rendered explorer.
 */
export function composeLocalExplorerSchema(
  coreSdl: string,
  extensionSdl: string | undefined,
): ExplorerSchema {
  const result = extensionSdl
    ? composeWithIntegrationLayer(coreSdl, extensionSdl, {
        integrationLayerUrl: LOCAL_IL_URL,
        extensionUrl: LOCAL_EXTENSION_URL,
      })
    : composeCoreOnly(coreSdl);

  if (!result.ok) {
    throw new Error(
      `could not compose the schema locally:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
  return {
    schema: result.apiSchema,
    sdl: result.apiSdl,
    describe: extensionSdl
      ? "local compose (core subgraph + your local extension)"
      : "local compose (core subgraph only — no extension in this directory)",
  };
}
