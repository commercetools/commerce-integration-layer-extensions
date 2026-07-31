// The `--gateway` half of the local dev server: an executable merged schema that
// routes each field to its owner — the local extension and the project's deployed
// integration layer — so a query like `{ product(id:…) { name loyaltyPoints(price:…) }}`
// resolves `name` from the integration layer and `loyaltyPoints` from the local
// extension in one request, the production topology in miniature.
//
// We use Apollo Gateway (the reference Federation
// implementation) because the extension model leans on `@interfaceObject` and only
// the reference gateway resolves that correctly. Both subgraphs are reached over
// HTTP, so the extension runs as a genuine subgraph; the integration-layer data
// source carries an anonymous session bearer (the integration layer re-validates the
// bearer's project against the URL).

import { ApolloGateway, RemoteGraphQLDataSource } from "@apollo/gateway";
import { INTEGRATION_LAYER_SERVICE } from "./compose.js";

/**
 * Mint an anonymous session and return its bearer token. The gateway attaches it to
 * every integration-layer subgraph request; the integration layer 403s a bearer
 * whose project doesn't match the URL, so an anonymous session is the minimum needed
 * to route real queries through. (A 30-day sliding TTL easily outlasts a dev session.)
 */
export async function mintAnonymousSession(
  integrationLayerUrl: string,
  projectKey: string,
): Promise<string> {
  const base = integrationLayerUrl.replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(projectKey)}/session`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "anonymous" }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`could not mint an anonymous session (${res.status}) at ${url}: ${text}`);
  }
  const token = (JSON.parse(text) as { token?: string }).token;
  if (!token) throw new Error("token response had no `token`");
  return token;
}

export interface GatewayOptions {
  /** The composed supergraph the planner routes against (from `composeWithIntegrationLayer`). */
  supergraphSdl: string;
  /** Anonymous session bearer, attached to the integration-layer data source's requests. */
  integrationLayerBearer: string;
}

/**
 * Build and load an Apollo Gateway over the composed supergraph. Each subgraph is an
 * HTTP data source addressed by its baked URL; the integration-layer one carries the
 * session bearer. Resolves once the gateway has loaded its query planner. Call
 * `.stop()` on the returned gateway when replacing it (on a schema change).
 */
export async function makeGateway(opts: GatewayOptions): Promise<ApolloGateway> {
  const gateway = new ApolloGateway({
    supergraphSdl: opts.supergraphSdl,
    buildService: ({ name, url }) =>
      new RemoteGraphQLDataSource({
        url,
        // Use Node's global `fetch` (undici) for every data source; Apollo Gateway's
        // default fetcher breaks its agent selection in some environments.
        fetcher: globalThis.fetch as unknown as RemoteGraphQLDataSource["fetcher"],
        willSendRequest: ({ request }) => {
          // Authenticate only the integration-layer subgraph; the extension subgraph
          // is the dev server's own internal endpoint and needs no bearer.
          if (name === INTEGRATION_LAYER_SERVICE) {
            request.http?.headers.set("authorization", `Bearer ${opts.integrationLayerBearer}`);
          }
        },
      }),
  });
  await gateway.load();
  return gateway;
}
