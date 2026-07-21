// Authoring API for commercetools API Extensions.
//
// Copied verbatim from commercetools/integration-layer-extension-examples
// (packages/tooling/src/apiExtension.ts). An API Extension is the commercetools
// platform feature: a synchronous HTTP callback commercetools makes before
// persisting a cart/order/… create or update, which can approve, modify, or BLOCK
// the write. This is a DIFFERENT thing from a GraphQL schema extension (typeDefs +
// resolvers), which adds fields to the graph. A bundle may export `apiExtensions`,
// `typeDefs`/`resolvers`, or both.
//
// A handler is a plain function `(input, ctx) => result`. Use `defineApiExtension`
// for type checking and the `approve` / `block` / `update` helpers to return intent
// instead of hand-rolling the wire shape. The runtime (the sandbox) maps the result
// to commercetools' response contract.
//
// The RECEIVED payload is the commercetools SDK's own `ExtensionInput` — you don't
// define the resource types. Its `resource` is the discriminated `Reference` union,
// so narrowing on `input.resource.typeId === 'cart'` gives you `resource.obj` typed
// as the real `Cart` (and so on). These are type-only imports (erased by the
// bundler), so they add nothing to the pushed bundle. The SDK does NOT model the
// RESPONSE envelope (approve/block/actions is an HTTP contract, not a resource), so
// `ApiExtensionResult` / `ApiExtensionError` below stay local.

import type { ExtensionAction, ExtensionInput } from '@commercetools/platform-sdk';

// Re-exported so a handler can annotate the payload without importing the SDK.
export type { ExtensionInput };

// The trigger actions we support — a subset of the SDK's (open) ExtensionAction.
export type ApiExtensionAction = Extract<ExtensionAction, 'Create' | 'Update'>;

// The per-call capability context — the same the sandbox grants a resolver: the
// merchant config map and a clock. The allowlist-gated global `fetch` is available
// for outbound calls (no import needed).
export interface ExtensionContext {
  now(): number;
  config: Readonly<Record<string, string>>;
}

// The payload commercetools POSTs — the SDK's ExtensionInput ({ action, resource }).
export type ApiExtensionInput = ExtensionInput;

export interface ApiExtensionError {
  code: string;
  message: string;
}

// What a handler returns: nothing/`{}` = approve; `{ actions }` = apply update
// actions; `{ errors }` = block.
export type ApiExtensionResult =
  | void
  | { actions?: unknown[]; errors?: ApiExtensionError[] };

export interface ApiExtensionDefinition {
  // Stable kebab-case id — becomes the commercetools extension key
  // `octolog-il-<key>`.
  key: string;
  // The commercetools resource the trigger fires on (e.g. 'cart', 'order').
  resourceTypeId: string;
  actions: ApiExtensionAction[];
  // Optional commercetools trigger predicate to limit when the callback fires.
  condition?: string;
  handler: (
    input: ApiExtensionInput,
    ctx: ExtensionContext,
  ) => ApiExtensionResult | Promise<ApiExtensionResult>;
}

/** Identity helper — declare an API-Extension handler, type-checked against the SDK payload. */
export function defineApiExtension(definition: ApiExtensionDefinition): ApiExtensionDefinition {
  return definition;
}

/** Approve the write unchanged. */
export function approve(): ApiExtensionResult {
  return {};
}

/** Block the write with a validation error (commercetools returns it to the caller). */
export function block(code: string, message: string): ApiExtensionResult {
  return { errors: [{ code, message }] };
}

/** Apply commercetools update actions to the triggering resource. */
export function update(actions: unknown[]): ApiExtensionResult {
  return { actions };
}
