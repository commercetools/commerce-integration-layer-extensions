/**
 * Example extension — ONE bundle doing TWO things at once, from the SAME config.
 *
 * It exports BOTH surfaces a bundle can contribute:
 *  - an **API Extension** (`apiExtensions`): a synchronous callback commercetools
 *    makes before it saves a cart write — this one BLOCKS the configured SKUs from
 *    being added to any cart (a cart Create/Update trigger). It changes API
 *    BEHAVIOUR, it does not add fields to the graph.
 *  - a **GraphQL schema extension** (`typeDefs` + `resolvers`): a new root field
 *    `Query.blockedSkus` that RETURNS the configured SKUs — an additive field on the
 *    graph, exactly like `examples/server-time`.
 *
 * Both read the SAME per-project config (`ctx.config.BLOCKED_SKU`) through the shared
 * `blockedSkus()` helper, so the API Extension that blocks a SKU and the query that
 * lists the blocked SKUs can never drift apart. `BLOCKED_SKU` is a comma-separated
 * list (set per project via the Merchant Center app / the extension config API);
 * when unset it falls back to the constant below.
 *
 * Try it locally without deploying:  `pnpm dev`  (→ `commercetools integration-layer
 * extension invoke-api-extension --input ./payloads/cart-create-blocked-sku.json`).
 * Edit the payload SKU to watch a non-blocked line pass. Then `pnpm validate` / `pnpm push`.
 *
 * A handler returns the plain runtime contract: `{}` to approve, `{ errors: [...] }`
 * to block, or `{ actions: [...] }` to modify — no imports from the CLI needed.
 */

import type { Cart, ExtensionInput } from '@commercetools/platform-sdk';

// Used when the project sets no BLOCKED_SKU config entry.
const DEFAULT_BLOCKED_SKU = 'BLOCKED-SKU';

/**
 * The blocked SKUs for a project, read from the SAME config both surfaces see:
 * a comma-separated `BLOCKED_SKU` list (trimmed, empties dropped), falling back to
 * the default when unset/empty.
 */
function blockedSkus(config: Record<string, string>): string[] {
  const skus = (config.BLOCKED_SKU ?? '')
    .split(',')
    .map((sku) => sku.trim())
    .filter((sku) => sku.length > 0);
  return skus.length > 0 ? skus : [DEFAULT_BLOCKED_SKU];
}

export const apiExtensions = [
  {
    key: 'cart-sku-blocker',
    resourceTypeId: 'cart',
    actions: ['Create', 'Update'],
    handler: (input: ExtensionInput, ctx: { now(): number; config: Record<string, string> }) => {
      const blocked = blockedSkus(ctx.config);
      // `input.resource` is the SDK's discriminated Reference union; narrowing on
      // typeId gives `obj` typed as the real commercetools `Cart`.
      const cart: Cart | undefined = input.resource.typeId === 'cart' ? input.resource.obj : undefined;
      const offending = (cart?.lineItems ?? []).find(
        (item) => item.variant.sku !== undefined && blocked.includes(item.variant.sku),
      );
      return offending
        ? { errors: [{ code: 'InvalidInput', message: `SKU "${offending.variant.sku}" cannot be added to the cart.` }] }
        : {};
    },
  },
];

export const typeDefs = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")

  type Query {
    "The SKUs the cart-sku-blocker API Extension refuses to add to a cart, for this project."
    blockedSkus: [String!]!
  }
`;

export const resolvers = {
  Query: {
    // Reads the SAME config the API Extension handler above blocks against.
    blockedSkus: (_parent: unknown, _args: unknown, ctx: { now(): number; config: Record<string, string> }) =>
      blockedSkus(ctx.config),
  },
};
