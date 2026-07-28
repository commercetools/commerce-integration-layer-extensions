/**
 * Example extension — an EXTERNAL SERVICE (Algolia) that ADDS a field returning
 * ENTITY STUBS. It attaches `Product.recommendations` to every product, computed from
 * Algolia's Recommend API. The resolver returns each recommended product as a Product
 * ENTITY STUB (`{ id }`, where the Algolia `objectID` is the raw commercetools product
 * id); the router re-enters the integration layer by that key (the `_entities` query)
 * for every other product field. So Algolia decides *which* products to recommend; the
 * integration layer remains the source of truth for product *detail*.
 *
 * KEY-FIELD NOTE. Because this subgraph RETURNS Product stubs (`ProductRecommendation
 * .product`), it must be able to PROVIDE the entity key — so `Product.id` is declared
 * NORMALLY, NOT `@external`. (`@external` says "another subgraph owns this", which
 * would leave the router unable to read the key off the value this resolver returns,
 * and composition fails. Use `@external` on a key only for pure attach-a-computed-
 * field extensions that never return the entity — e.g. `examples/loyalty-points`.)
 *
 * RELAY-GID NOTE. `Product.id` is an OPAQUE Relay global id (a fixed-length, masked,
 * base64url handle) — NOT the raw commercetools UUID it used to be. An extension must
 * treat it as opaque: never parse it, never compare it to a raw CT id, never key an
 * external system by it. Algolia's index IS keyed by the raw CT product id, so this
 * example pulls the native id in via `@requires(fields: "_ctId")` — an internal,
 * integration-layer-owned field (`@inaccessible` there, so shoppers never see it) —
 * and keys the lookup off `_ctId`, not `id`. On the way back, each recommended
 * objectID is a raw CT id returned as the stub's `id`: the core subgraph's `_entities`
 * resolver decodes gids leniently (a non-gid passes through as the raw id) and
 * re-encodes the opaque id outbound, so a raw-id stub resolves correctly. The
 * extension must NOT try to construct the opaque gid itself — the codec is internal.
 *
 * v2 SCOPE. v1 also `@override`d `Query.productSearch` (a search-specific result type)
 * to rank search with Algolia. v2's discovery field is `Query.search: ProductSearch
 * Connection!`, a Relay connection built from SHARED value types (`PageInfo`,
 * `ProductEdge`) reused by every other connection. Overriding those from the extension
 * would seize them graph-wide and break unrelated connections (verified at compose
 * time), and the integration layer emits no `@shareable` for co-ownership — so the
 * search-override pattern has no faithful v2 form from an extension alone. It is
 * dropped here; the recommendations pattern below is the v2-valid External-Service
 * example.
 *
 * HTTP via a STANDARD SDK. Uses the official `algoliasearch` client directly. The
 * runtime exposes a global `fetch` limited to an operator-configured host allowlist
 * (Algolia's by default); the SDK's fetch transport uses it transparently. The Algolia
 * App ID/index/search-key are read from `ctx.config` (the key a host-side `secret`,
 * never baked into the bundle) — keep it search-only. An SDK must be fetch-based (the
 * runtime provides no Node `http`/`https`).
 *
 * An independent, project-agnostic template. Edit this file, then run `pnpm validate`
 * / `pnpm push` from this directory (the target project comes from the shared `.env`).
 * See the README's "Authoring constraints".
 */

import { algoliasearch } from "algoliasearch";

// --- Algolia connection comes from per-project config (ctx.config), NOT baked
// into the bundle. The merchant sets it via the integration layer's
// /extensions/config endpoint; see `algoliaConnection` and the SECRETS note. ---
// Recommend model: "bought-together" | "related-products" | "looking-similar".
const ALGOLIA_MODEL = "related-products";
const MAX_RECOMMENDATIONS = 5;
const RECOMMENDATION_REASON = "related product";

export const typeDefs = `
  extend schema @link(
    url: "https://specs.apollo.dev/federation/v2.3"
    import: ["@key", "@requires", "@external"]
  )

  "Recommendations this subgraph attaches to every product, keyed by the product's id."
  type Product @key(fields: "id") {
    "The entity key — declared NORMALLY (not @external): this resolver RETURNS Product stubs so it must PROVIDE the key, and an @external key would also break @requires planning."
    id: ID!
    "Internal, integration-layer-owned: the product's RAW commercetools id. The public \`id\` is an OPAQUE Relay global id we must never parse, so we pull the native id in via @requires to key Algolia's index (whose objectID is the CT product id). @external — the core subgraph owns and resolves it; @inaccessible there, so it never reaches shoppers."
    _ctId: ID! @external
    "Products recommended alongside this one, from Algolia. Nullable so an Algolia outage degrades to \`null\` instead of nullifying the whole product."
    recommendations: [ProductRecommendation!] @requires(fields: "_ctId")
  }

  "One recommended product."
  type ProductRecommendation {
    "The recommended product itself, as a federation entity — the resolver returns only its \`id\` (the raw CT product id from Algolia's objectID) and the router re-enters the integration layer, which resolves it (leniently accepting a raw id) and fills in the rich catalog data (the join target)."
    product: Product!
    "Why this product was recommended."
    reason: String!
  }
`;

/** The host-mediated capabilities the runtime grants a resolver (the third arg). */
interface ExtensionContext {
  now(): number;
  /**
   * Per-project configuration the merchant set via the integration layer's
   * `/extensions/config` endpoint (secret values decrypted host-side). A flat
   * string map; empty when nothing is configured.
   */
  config: Readonly<Record<string, string>>;
}

/** Algolia connection details, read from per-project config. */
interface AlgoliaConnection {
  appId: string;
  apiKey: string;
  index: string;
}

/**
 * Read the Algolia connection from `ctx.config`. Returns null when any of the
 * three keys is missing/empty, so the resolver can degrade gracefully instead
 * of calling Algolia with bad credentials.
 */
function algoliaConnection(ctx: ExtensionContext): AlgoliaConnection | null {
  const appId = ctx.config.ALGOLIA_APP_ID;
  const apiKey = ctx.config.ALGOLIA_API_KEY;
  const index = ctx.config.ALGOLIA_INDEX_NAME;
  if (!appId || !apiKey || !index) return null;
  return { appId, apiKey, index };
}

export const resolvers = {
  Product: {
    // `product` is the entity representation the integration layer resolved — its
    // key (`id`, an opaque Relay gid) plus the `_ctId` we pulled in with @requires.
    // We ask Algolia for products to recommend alongside it, then return each as a
    // Product entity STUB (`{ id }`) — the router resolves the rich catalog data
    // back from the integration layer (the join target).
    recommendations: async (
      product: { id: string; _ctId: string },
      _args: unknown,
      ctx: ExtensionContext,
    ) => {
      const algolia = algoliaConnection(ctx);
      // Not configured → degrade to null (the field is nullable).
      if (!algolia) return null;
      try {
        // The official SDK's Recommend client, over the global fetch.
        const client = algoliasearch(algolia.appId, algolia.apiKey);
        const response = await client.initRecommend().getRecommendations({
          requests: [
            {
              indexName: algolia.index,
              model: ALGOLIA_MODEL,
              // Algolia's index is keyed by the RAW commercetools product id, so key
              // the lookup off `_ctId` (the native id) — NOT `product.id`, which is
              // now an opaque Relay gid the extension must never parse.
              objectID: product._ctId,
              threshold: 0,
              maxRecommendations: MAX_RECOMMENDATIONS,
            },
          ],
        });

        const hits = response.results?.[0]?.hits ?? [];
        return hits
          // The Recommend hit union includes trending-facet hits without an
          // objectID; keep only product hits (those carry the CT product id).
          .map((hit) => ("objectID" in hit ? hit.objectID : undefined))
          .filter((id): id is string => typeof id === "string")
          // Return Product stubs. Each objectID IS the raw CT product id; the core
          // subgraph's `_entities` resolver accepts a raw id as the `id` key (it
          // decodes gids leniently, leaving a non-gid untouched) and re-encodes the
          // opaque id on the way back out. We must NOT synthesise the opaque gid
          // ourselves — the encoding is internal to the integration layer.
          .map((id) => ({ product: { id }, reason: RECOMMENDATION_REASON }));
      } catch {
        // Algolia unavailable/misconfigured: degrade to `null` (the field is
        // nullable) so the rest of the product still resolves.
        return null;
      }
    },
  },
};
