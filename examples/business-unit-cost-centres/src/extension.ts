/**
 * Example extension — attaching to an entity by its READABLE KEY rather than its id,
 * and to something other than `Product`.
 *
 * B2B: each business unit books orders against its own cost centres, which live in the
 * customer's finance system, not in commercetools. A buyer needs to pick one at
 * checkout, so the storefront needs them on the business unit:
 *
 *     query { businessUnit(key: "acme-eu") { name  costCentres } }
 *
 * ── Why `@key(fields: "key")` ──────────────────────────────────────────────────
 * Most integration-layer entities can be attached to by EITHER `id` or `key`. Reach
 * for `key` when your side of the data is keyed by the same readable handle a human
 * typed — as here, where a finance admin maintains the mapping per business unit.
 * With `@key(fields: "key")` the router hands your resolver `{ key: "acme-eu" }` and
 * you can look straight up; keying by `id` would force you to keep a second table of
 * opaque ids, which nobody wants to maintain (and `Product.id` in particular is an
 * opaque Relay global id, never a raw commercetools id).
 *
 * The trade-off: an instance whose `key` is null is not reachable through the `key`
 * representation, so `key`-keyed fields resolve to null there. `BusinessUnit.key` is
 * non-null in the integration layer's schema (as is `Category.key`), so that is safe
 * here — check before keying by an optional `key`.
 *
 * The same one-line shape works for the other entities the README's entity catalog
 * lists — `Customer`, `Category`, `Order`, `Cart`, `Quote`, `ShoppingList`, … — this
 * template just happens to pick the B2B one.
 *
 * ── Runtime shape ──────────────────────────────────────────────────────────────
 * A pure, synchronous lookup with no network call at all: the mapping is small,
 * merchant-maintained data, so it lives in the project's extension config as JSON.
 * Swap the lookup for a `fetch` against the finance system (see
 * `algolia-recommendations`) if it has to be live.
 *
 *     commercetools integration-layer config set COST_CENTRES \
 *       '{"acme-eu":["EU-01","EU-02"],"acme-us":["US-07"]}'
 */

// Per-project config: a JSON object of `businessUnitKey → cost centre codes`.
const CONFIG_KEY = 'COST_CENTRES';

interface ExtensionContext {
  now(): number;
  config: Readonly<Record<string, string>>;
}

export const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"])

  type BusinessUnit @key(fields: "key") {
    "The entity key — the readable handle this extension attaches by. Declared NORMALLY (not @external): it identifies the entity."
    key: String!
    "Cost centre codes this business unit may book orders against, from the merchant's finance system. Empty when none are configured for it."
    costCentres: [String!]!
  }
`;

/**
 * The configured `businessUnitKey → codes` map. Unparseable or absent config yields an
 * empty map, so every business unit reports no cost centres rather than the field
 * failing — an unconfigured project still serves the rest of the graph.
 */
function costCentresByUnit(config: Readonly<Record<string, string>>): Record<string, string[]> {
  const raw = config[CONFIG_KEY];
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [unitKey, codes] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(codes)) out[unitKey] = codes.filter((c): c is string => typeof c === 'string');
    }
    return out;
  } catch {
    return {};
  }
}

export const resolvers = {
  BusinessUnit: {
    // `parent` is the entity representation the router resolved for the declared key —
    // `{ key: "acme-eu" }` — and nothing else. That is the whole point of keying by
    // `key`: the lookup handle arrives ready to use.
    costCentres: (
      businessUnit: { key: string },
      _args: unknown,
      ctx: ExtensionContext,
    ): string[] => costCentresByUnit(ctx.config)[businessUnit.key] ?? [],
  },
};
