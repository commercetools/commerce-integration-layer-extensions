// Authoring API for commercetools API Extensions.
//
// An API Extension is the commercetools platform feature: a synchronous HTTP
// callback commercetools makes before persisting a cart/order/… create or update,
// which can approve, modify, or BLOCK the write. This is a DIFFERENT thing from a
// GraphQL schema extension (typeDefs + resolvers), which adds fields to the graph.
// A bundle may export `apiExtensions`, `typeDefs`/`resolvers`, or both.
//
// A handler is a plain function `(input, ctx) => result`. Use `defineApiExtension`
// for type inference and the `approve` / `block` / `update` helpers to return
// intent instead of hand-rolling the wire shape. The runtime (the sandbox) maps
// the result to commercetools' response contract.

export type ApiExtensionAction = 'Create' | 'Update';

// The per-call capability context — the same the sandbox grants a resolver: the
// merchant config map and a clock. The allowlist-gated global `fetch` is available
// for outbound calls (no import needed).
export interface ExtensionContext {
  now(): number;
  config: Readonly<Record<string, string>>;
}

// The payload commercetools POSTs: the resource that triggered the callback. `obj`
// is the full resource; type it per handler (e.g. `Cart`) via the generic.
export interface ApiExtensionInput<Obj = Record<string, unknown>> {
  action: ApiExtensionAction;
  resource: {
    typeId: string;
    id: string;
    obj?: Obj;
  };
}

export interface ApiExtensionError {
  code: string;
  message: string;
}

// What a handler returns: nothing/`{}` = approve; `{ actions }` = apply update
// actions; `{ errors }` = block.
export type ApiExtensionResult =
  | void
  | { actions?: unknown[]; errors?: ApiExtensionError[] };

export interface ApiExtensionDefinition<Obj = Record<string, unknown>> {
  // Stable kebab-case id — becomes the commercetools extension key
  // `octolog-il-<key>`.
  key: string;
  // The commercetools resource the trigger fires on (e.g. 'cart', 'order').
  resourceTypeId: string;
  actions: ApiExtensionAction[];
  // Optional commercetools trigger predicate to limit when the callback fires.
  condition?: string;
  handler: (
    input: ApiExtensionInput<Obj>,
    ctx: ExtensionContext,
  ) => ApiExtensionResult | Promise<ApiExtensionResult>;
}

/** Identity helper — declare an API-Extension handler with full type inference. */
export function defineApiExtension<Obj = Record<string, unknown>>(
  definition: ApiExtensionDefinition<Obj>,
): ApiExtensionDefinition<Obj> {
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

// A minimal Cart shape for cart handlers — just enough to read line-item SKUs.
// (Not the full commercetools Cart; extend as a handler needs.)
export interface CartLike {
  id?: string;
  lineItems?: {
    id?: string;
    quantity?: number;
    variant?: { sku?: string };
  }[];
}
