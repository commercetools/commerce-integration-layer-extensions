/**
 * Example extension — an EXTERNAL SERVICE (Algolia) that ADDS a field returning
 * ENTITY STUBS. It attaches `Product.recommendations` to every product, computed from
 * Algolia's Recommend API. The resolver returns each recommended product as a Product
 * ENTITY STUB (`{ id }`, where the Algolia `objectID` == the commercetools product id);
 * the router re-enters the integration layer by that key (the `_entities` query) for
 * every other product field. So Algolia decides *which* products to recommend; the
 * integration layer remains the source of truth for product *detail*.
 *
 * KEY-FIELD NOTE. Because this subgraph RETURNS Product stubs (`ProductRecommendation
 * .product`), it must be able to PROVIDE the entity key — so `Product.id` is declared
 * NORMALLY, NOT `@external`. (`@external` says "another subgraph owns this", which
 * would leave the router unable to read the key off the value this resolver returns,
 * and composition fails. Use `@external` on a key only for pure attach-a-computed-
 * field extensions that never return the entity — e.g. `examples/loyalty-points`.)
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
    import: ["@key"]
  )

  "Recommendations this subgraph attaches to every product, keyed by the product's id."
  type Product @key(fields: "id") {
    id: ID!
    "Products recommended alongside this one, from Algolia. Nullable so an Algolia outage degrades to \`null\` instead of nullifying the whole product."
    recommendations: [ProductRecommendation!]
  }

  "One recommended product."
  type ProductRecommendation {
    "The recommended product itself, as a federation entity — the resolver returns only its \`id\` (the Algolia objectID, which is the commercetools product id) and the router resolves the rich catalog data from the integration layer (the join target)."
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
    // `product` is the entity representation the integration layer resolved
    // (`{ id }`). We ask Algolia for products to recommend alongside it, then return
    // each as a Product entity STUB (`{ id }`) — the router resolves the rich catalog
    // data back from the integration layer (the join target).
    recommendations: async (product: { id: string }, _args: unknown, ctx: ExtensionContext) => {
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
              objectID: product.id,
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
          .map((id) => ({ product: { id }, reason: RECOMMENDATION_REASON }));
      } catch {
        // Algolia unavailable/misconfigured: degrade to `null` (the field is
        // nullable) so the rest of the product still resolves.
        return null;
      }
    },
  },
};
