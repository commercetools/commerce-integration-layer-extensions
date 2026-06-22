/**
 * Example extension — using an EXTERNAL SERVICE (Algolia), two ways:
 *
 *   1. ADD a field via `@interfaceObject` (`Product.recommendations`): attach a new
 *      field to every product, computed from Algolia's Recommend API.
 *
 *   2. OVERRIDE a field via `@override` + make the integration layer a JOIN TARGET
 *      (`Query.productSearch`): take over product search at the federation edge so
 *      Algolia ranks it, while returning the same rich `Product` shape. The resolver
 *      returns only product STUBS (`{ id }`, the Algolia `objectID` == the product
 *      id); the router re-enters the integration layer by that key (the `_entities`
 *      query) for every other field. So Algolia decides *which* products and *in what
 *      order*; the integration layer remains the source of truth for product *detail*.
 *      `integration-layer` is the subgraph name `@override(from: …)` references.
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
const DEFAULT_SEARCH_LIMIT = 24;

export const typeDefs = `
  extend schema @link(
    url: "https://specs.apollo.dev/federation/v2.3"
    import: ["@key", "@interfaceObject", "@override"]
  )

  type Query {
    """
    Product search, powered by Algolia. @override takes ownership of this field
    from the \`integration-layer\` subgraph at the federation edge, so Algolia ranks
    the results — but the items are returned as Product stubs and the router resolves
    their rich detail back from the integration layer (the join target), so the shape
    is identical to the integration layer's own search.
    """
    productSearch(input: ProductSearchInput!): ProductSearchResult!
      @override(from: "integration-layer")
  }

  "Recommendations this subgraph attaches to every product, via @interfaceObject."
  type Product @key(fields: "id") @interfaceObject {
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

  # --- Value types the @override'd productSearch returns. Federation requires this
  # subgraph to DECLARE every type its fields reference, so these mirror the
  # integration layer's definitions (same field names/types). But rather than co-own
  # them (@shareable) we take EXCLUSIVE ownership via field-level @override(from:
  # "integration-layer") — the same way productSearch itself is overridden — so the
  # extension is the sole resolver of the search result in the federated graph and the
  # integration layer needs no compose-time @shareable. (@override only governs the
  # routed supergraph.) ---

  type ProductSearchResult {
    items: [Product!]! @override(from: "integration-layer")
    total: Int! @override(from: "integration-layer")
    count: Int! @override(from: "integration-layer")
    facets: [FacetResult!]! @override(from: "integration-layer")
    facetDefinitions: [FacetDefinition!]! @override(from: "integration-layer")
    nextCursor: String @override(from: "integration-layer")
    previousCursor: String @override(from: "integration-layer")
  }

  type FacetResult {
    name: String! @override(from: "integration-layer")
    buckets: [FacetBucket!]! @override(from: "integration-layer")
  }

  type FacetBucket {
    key: String! @override(from: "integration-layer")
    count: Int! @override(from: "integration-layer")
  }

  type FacetDefinition {
    attributeType: String @override(from: "integration-layer")
    attributeId: String @override(from: "integration-layer")
    attributeLabel: String @override(from: "integration-layer")
    attributeValues: [FacetDefinitionValue!] @override(from: "integration-layer")
  }

  type FacetDefinitionValue {
    key: String! @override(from: "integration-layer")
    label: String! @override(from: "integration-layer")
  }

  enum SortOrderEnum {
    ASC
    DESC
  }

  enum ProductFilterType {
    TERM
    ENUM
    BOOLEAN
    RANGE
  }

  input ProductFilterInput {
    identifier: String!
    type: ProductFilterType!
    terms: [String!]
    min: Float
    max: Float
  }

  input ProductSearchInput {
    query: String
    categoryIds: [ID!]
    filters: [ProductFilterInput!]
    selectedFacets: [ProductFilterInput!]
    sortField: String
    sortOrder: SortOrderEnum
    cursor: String
    limit: Int = ${DEFAULT_SEARCH_LIMIT}
    language: String
    country: String
    currency: String
    storeKey: String
    distributionChannelId: String
    supplyChannelId: String
    productSelectionId: String
    accountGroupIds: [String!]
    productIds: [ID!]
    productKeys: [String!]
    skus: [String!]
    withFacets: Boolean = true
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
 * three keys is missing/empty, so each resolver can degrade gracefully instead
 * of calling Algolia with bad credentials.
 */
function algoliaConnection(ctx: ExtensionContext): AlgoliaConnection | null {
  const appId = ctx.config.ALGOLIA_APP_ID;
  const apiKey = ctx.config.ALGOLIA_API_KEY;
  const index = ctx.config.ALGOLIA_INDEX_NAME;
  if (!appId || !apiKey || !index) return null;
  return { appId, apiKey, index };
}

/** A subset of the ProductSearchInput we know how to translate to Algolia. */
interface ProductSearchInput {
  query?: string | null;
  limit?: number | null;
  cursor?: string | null;
  filters?: ProductFilterArg[] | null;
  selectedFacets?: ProductFilterArg[] | null;
}

interface ProductFilterArg {
  identifier: string;
  type: "TERM" | "ENUM" | "BOOLEAN" | "RANGE";
  terms?: string[] | null;
  min?: number | null;
  max?: number | null;
}

// The integration layer's cursor form is "offset:N"; parse it back to a numeric offset.
function offsetFromCursor(cursor?: string | null): number {
  if (!cursor) return 0;
  const match = /^offset:(\d+)$/.exec(cursor);
  return match ? Number(match[1]) : 0;
}

// Translate the typed filters into Algolia facet/numeric filters. Each filter's
// terms become an OR group (inner array); filters are AND-ed (outer array).
function toAlgoliaFilters(filters: ProductFilterArg[]): {
  facetFilters: string[][];
  numericFilters: string[];
} {
  const facetFilters: string[][] = [];
  const numericFilters: string[] = [];
  for (const f of filters) {
    if (f.type === "RANGE") {
      if (typeof f.min === "number") numericFilters.push(`${f.identifier}>=${f.min}`);
      if (typeof f.max === "number") numericFilters.push(`${f.identifier}<=${f.max}`);
    } else if (f.terms && f.terms.length > 0) {
      facetFilters.push(f.terms.map((t) => `${f.identifier}:${t}`));
    }
  }
  return { facetFilters, numericFilters };
}

export const resolvers = {
  Query: {
    // Algolia-powered product search. Returns Product STUBS ({ id }); the router
    // resolves each id's rich detail back from the integration layer via the join.
    productSearch: async (
      _parent: unknown,
      args: { input: ProductSearchInput },
      ctx: ExtensionContext,
    ) => {
      const input = args.input ?? {};
      const algolia = algoliaConnection(ctx);
      // No Algolia config set for this project → return a valid empty result
      // (the field is non-null, so we can't return null).
      if (!algolia) {
        return {
          items: [],
          total: 0,
          count: 0,
          facets: [],
          facetDefinitions: [],
          nextCursor: null,
          previousCursor: null,
        };
      }
      const length = input.limit ?? DEFAULT_SEARCH_LIMIT;
      const offset = offsetFromCursor(input.cursor);
      const { facetFilters, numericFilters } = toAlgoliaFilters([
        ...(input.filters ?? []),
        ...(input.selectedFacets ?? []),
      ]);

      // The official SDK over the global `fetch`.
      const client = algoliasearch(algolia.appId, algolia.apiKey);
      const response = await client.searchSingleIndex({
        indexName: algolia.index,
        searchParams: {
          query: input.query ?? "",
          offset,
          length,
          facets: ["*"],
          ...(facetFilters.length ? { facetFilters } : {}),
          ...(numericFilters.length ? { numericFilters } : {}),
        },
      });

      const items = (response.hits ?? [])
        .map((hit) => hit.objectID)
        .filter((id): id is string => typeof id === "string")
        .map((id) => ({ id }));

      const total = response.nbHits ?? items.length;
      const count = items.length;

      // Algolia returns facet counts as { facetName: { value: count } }. Map them
      // into the integration layer's FacetResult shape. facetDefinitions stays empty —
      // those are display labels the integration layer derives from product types, and
      // Algolia has no equivalent metadata.
      const facets = Object.entries(response.facets ?? {}).map(([name, values]) => ({
        name,
        buckets: Object.entries(values).map(([key, bucketCount]) => ({
          key,
          count: bucketCount,
        })),
      }));

      return {
        items,
        total,
        count,
        facets,
        facetDefinitions: [],
        nextCursor: offset + count < total ? `offset:${offset + count}` : null,
        previousCursor: offset > 0 ? `offset:${Math.max(0, offset - length)}` : null,
      };
    },
  },
  Product: {
    // `product` is the entity representation the integration layer resolved
    // (`{ id }`). We ask Algolia for products to recommend alongside it, then return
    // each as a Product entity STUB (`{ id }`) — the router resolves the rich catalog
    // data back from the integration layer (the join target), like the search items.
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
