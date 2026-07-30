/**
 * Example extension — TAKING OVER an existing integration-layer field with
 * `@override`, the one schema pattern the other templates never show.
 *
 * The integration layer already serves `Query.categoryProductCounts` (how many
 * products sit in each category subtree). If you run your own search engine, its
 * facet counts are the numbers your listing pages must agree with — the counts next
 * to the filters and the results you get when you click one have to come from the
 * same index. So rather than add a second, competing field, this extension claims the
 * existing one: same name, same arguments, same result type, your data.
 *
 * Clients change nothing. `Query.categoryProductCounts` keeps working; it is simply
 * answered by the extension now.
 *
 * ── The composition rule (this is the fiddly part) ───────────────────────────────
 * Federation cannot import types across subgraphs, so to declare the field you must
 * re-declare its result type here too — and then BOTH subgraphs define
 * `CategoryProductCount.category` / `.count`, which federation rejects as a
 * non-shareable field resolved twice. The fix is to `@override` those fields as well,
 * not just the root field:
 *
 *     type CategoryProductCount {
 *       category: Category! @override(from: "integration-layer")
 *       count: Int!         @override(from: "integration-layer")
 *     }
 *
 * (`@shareable` does NOT work here: the integration layer does not mark its own copy
 * shareable, and co-ownership needs both sides to agree.)
 *
 * `Category` is an entity, so it is NOT re-declared in full — just its key, and the
 * resolver returns `{ id }` stubs the router resolves back against the integration
 * layer. That is what keeps the caller's `category { name slug … }` selection working.
 *
 * Only override a field whose result types are its OWN. `CategoryProductCount` is used
 * by nothing else, so claiming it is contained. Overriding a field whose result reuses
 * SHARED types (the Relay `PageInfo`/`ProductEdge` behind `Query.search`) seizes those
 * types graph-wide and breaks every other field that uses them — see the README.
 *
 * ── What you take on ───────────────────────────────────────────────────────────
 * You now own the field's availability. Its type is non-null (`[CategoryProductCount!]!`
 * — you cannot narrow it), so there is no null to degrade to: if your service is down,
 * the field errors. An additive field can shrug an outage off; an override cannot.
 * If that is not a trade you want, add a new field instead of overriding.
 *
 *     commercetools integration-layer config set SEARCH_COUNTS_URL https://search.example.com/counts
 *     commercetools integration-layer config set SEARCH_API_KEY <key> --secret
 */

// Per-project config: the counts endpoint, and the key it wants (stored as a secret,
// so it is encrypted at rest and never returned by a config read).
const URL_KEY = 'SEARCH_COUNTS_URL';
const API_KEY = 'SEARCH_API_KEY';

interface ExtensionContext {
  now(): number;
  config: Readonly<Record<string, string>>;
}

/** What the search service answers with: a count per commercetools category id. */
interface CountsResponse {
  counts?: { categoryId?: unknown; count?: unknown }[];
}

export const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@override"])

  type Query {
    "Product counts per category subtree, served from this project's own search index instead of the integration layer's. Same signature as the field it replaces."
    categoryProductCounts(categoryIds: [ID!]): [CategoryProductCount!]! @override(from: "integration-layer")
  }

  "Re-declared so this subgraph can name it as a result type. Every field is @override-d: without that, federation sees the same field resolved by two subgraphs and refuses to compose."
  type CategoryProductCount {
    category: Category! @override(from: "integration-layer")
    count: Int! @override(from: "integration-layer")
  }

  "An entity, so only its key is declared here — the resolver returns { id } stubs and the router fetches the rest from the integration layer."
  type Category @key(fields: "id") {
    id: ID!
  }
`;

export const resolvers = {
  Query: {
    categoryProductCounts: async (
      _parent: unknown,
      args: { categoryIds?: string[] | null },
      ctx: ExtensionContext,
    ): Promise<{ category: { id: string }; count: number }[]> => {
      const url = ctx.config[URL_KEY];
      // Overriding means owning: an unconfigured project cannot answer this field at
      // all, and there is no null to fall back to. Fail loudly rather than serve a
      // plausible-looking empty list that hides the misconfiguration.
      if (!url) {
        throw new Error(
          `categoryProductCounts is served by this extension but ${URL_KEY} is not configured`,
        );
      }

      const query = new URLSearchParams();
      for (const id of args.categoryIds ?? []) query.append('categoryId', id);
      const apiKey = ctx.config[API_KEY];
      const response = await fetch(`${url}?${query.toString()}`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      });
      if (!response.ok) {
        throw new Error(`search counts request failed: HTTP ${response.status}`);
      }
      const body = (await response.json()) as CountsResponse;

      return (body.counts ?? [])
        .filter(
          (entry): entry is { categoryId: string; count: number } =>
            typeof entry.categoryId === 'string' && typeof entry.count === 'number',
        )
        // A bare `{ id }` stub per category: the router re-enters the integration
        // layer for whatever else the caller selected on `category`.
        .map((entry) => ({ category: { id: entry.categoryId }, count: entry.count }));
    },
  },
};
