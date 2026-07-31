// Compose the local extension subgraph with the project's live integration-layer
// subgraph — the same two-subgraph composition the integration layer runs on publish.
//
// `composeWithIntegrationLayer` below is the low-level half. Fetching the project's
// subgraph SDL is a plain authenticated HTTP call, so it lives separately in
// `../ilClient.ts`, parameterised by (baseUrl, projectKey, token) with the command
// layer supplying the token.

import { parse, printSchema, type GraphQLSchema } from "graphql";
import { composeServices } from "@apollo/composition";

/** The subgraph names the integration layer composes under — matched here so the
 *  local composition mirrors the deployed one. `integration-layer` is the name an
 *  extension's `@override(from: …)` references. */
export const INTEGRATION_LAYER_SERVICE = "integration-layer";
export const EXTENSION_SERVICE = "extensions";

export type ComposeResult =
  | {
      ok: true;
      /** The client-facing API schema (federation directives stripped), browsable. */
      apiSchema: GraphQLSchema;
      /** Printed API-schema SDL — "what the full schema looks like" to a consumer. */
      apiSdl: string;
      /** The raw composed supergraph SDL the router plans against. */
      supergraphSdl: string;
    }
  | { ok: false; errors: string[] };

/**
 * Compose the integration layer + the extension into a supergraph and derive the
 * client-facing API schema. Never throws — a composition failure comes back in
 * `errors` so the dev server can surface it and keep serving. The URLs are baked into
 * the supergraph so `--gateway` routes correctly; for `--compose` they're cosmetic.
 */
export function composeWithIntegrationLayer(
  integrationLayerSdl: string,
  extensionSdl: string,
  urls: { integrationLayerUrl: string; extensionUrl: string },
): ComposeResult {
  let services;
  try {
    services = [
      { name: INTEGRATION_LAYER_SERVICE, typeDefs: parse(integrationLayerSdl), url: urls.integrationLayerUrl },
      { name: EXTENSION_SERVICE, typeDefs: parse(extensionSdl), url: urls.extensionUrl },
    ];
  } catch (err) {
    return { ok: false, errors: [`SDL is not valid GraphQL: ${(err as Error).message}`] };
  }

  const result = composeServices(services);
  // `errors` is the discriminant of the composition-failure variant; its presence
  // narrows `result` to the success variant (with `schema` + `supergraphSdl`).
  if (result.errors) {
    return { ok: false, errors: result.errors.map((e) => e.message) };
  }

  const apiSchema = result.schema.toAPISchema().toGraphQLJSSchema();
  return {
    ok: true,
    apiSchema,
    apiSdl: printSchema(apiSchema),
    supergraphSdl: result.supergraphSdl,
  };
}
