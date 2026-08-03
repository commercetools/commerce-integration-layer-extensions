/**
 * Example extension — an API Extension that MODIFIES a write instead of blocking it,
 * and the only template that is API-EXTENSIONS-ONLY (no GraphQL subgraph at all).
 *
 * `cart-sku-blocker` shows the *block* outcome (`{ errors: [...] }`). The other half of
 * the contract is the *modify* outcome: return `{ actions: [...] }` and commercetools
 * applies those update actions as part of the very write it is asking you about. Here:
 * a per-line quantity cap. A shopper (or a mis-clicking script) adding 500 of a
 * one-per-household item gets their line silently trimmed to the cap rather than a
 * hard error.
 *
 *   - `{}`                → approve, unchanged
 *   - `{ errors: [...] }` → block the whole write (cart-sku-blocker)
 *   - `{ actions: [...] }`→ approve, having applied these update actions ← THIS ONE
 *
 * The actions are ordinary commercetools cart update actions, the same ones the API
 * accepts — `changeLineItemQuantity` here. Nothing is stored by the extension; the
 * corrected quantity IS the write.
 *
 * ── No typeDefs ────────────────────────────────────────────────────────────────
 * A bundle does not have to contribute a schema. This one exports only
 * `apiExtensions`, which is why `validate`/`push` skip GraphQL composition for it —
 * there is no SDL to compose. Reach for this shape when your extension changes API
 * BEHAVIOUR and adds nothing for a client to query.
 *
 * ── `condition` ────────────────────────────────────────────────────────────────
 * The optional `condition` is a commercetools query predicate: commercetools
 * evaluates it and only calls the extension when it matches, so an unrelated write
 * (an address change on an empty cart) never pays for a round trip. Cheap, and worth
 * setting whenever your handler would obviously no-op.
 *
 * ── Try it locally ─────────────────────────────────────────────────────────────
 *     pnpm dev
 *     commercetools integration-layer extension invoke-api-extension --input ./payloads/cart-create-over-cap.json --config MAX_LINE_QUANTITY=1
 */

import type { Cart, ExtensionInput } from '@commercetools/platform-sdk';

// Per-project cap, e.g. `commercetools integration-layer config set MAX_LINE_QUANTITY 10`.
const CONFIG_KEY = 'MAX_LINE_QUANTITY';

/**
 * The cap for this project, or `null` when it is not configured / not a positive
 * integer. Unconfigured means "no cap": the handler approves every cart untouched,
 * rather than inventing a limit the merchant never asked for.
 */
function quantityCap(config: Readonly<Record<string, string>>): number | null {
  const raw = config[CONFIG_KEY];
  if (raw === undefined) return null;
  const cap = Number(raw);
  return Number.isInteger(cap) && cap > 0 ? cap : null;
}

export const apiExtensions = [
  {
    key: 'cart-quantity-cap',
    resourceTypeId: 'cart',
    actions: ['Create', 'Update'],
    // Skip the callback entirely for carts with nothing in them.
    condition: 'lineItems is not empty',
    handler: (
      input: ExtensionInput,
      ctx: { now(): number; config: Readonly<Record<string, string>> },
    ) => {
      const cap = quantityCap(ctx.config);
      if (cap === null) return {}; // not configured → no cap
      // `input.resource` is the SDK's discriminated Reference union; narrowing on
      // typeId gives `obj` typed as the real commercetools Cart.
      const cart: Cart | undefined = input.resource.typeId === 'cart' ? input.resource.obj : undefined;
      const actions = (cart?.lineItems ?? [])
        .filter((item) => item.quantity > cap)
        .map((item) => ({
          action: 'changeLineItemQuantity',
          lineItemId: item.id,
          quantity: cap,
        }));
      // No offending line → approve untouched. Otherwise hand commercetools the
      // corrections; it applies them as part of this write.
      return actions.length > 0 ? { actions } : {};
    },
  },
];
