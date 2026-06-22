# example-extensions

Example **extension** templates for the commercetools integration layer — the
merchant subgraph code the integration layer runs — plus the tool that builds,
validates, and publishes it.

This is **not a deployed service**. It is a set of small authored artifacts (the
example templates under `examples/*`) and a shared tool (`ee-ext`) that uploads a
built bundle into the integration layer's per-project object store. The integration
layer's runtime fetches it from there and serves it as a federated subgraph.

## Getting started

Onboarding a project to the integration layer has two steps — one on the
commercetools side, one on yours.

### 1. commercetools enables the integration layer for your project

Ask your commercetools contact to enable the integration layer for your project.
Once it's enabled, your project is served by the integration layer — it exposes the
project's GraphQL endpoint and accepts the extension you publish from this
repository. There is nothing to install on your side for this step.

### 2. Configure and publish your extension

With the integration layer enabled, you author, configure, and publish an extension:

1. **Create an API Client.** In the Merchant Center (Settings → Developer settings →
   API clients), create an API Client for your project with the `manage_project`
   scope. Its credentials authorize publishing.
2. **Set up this repository.** Clone it and run `pnpm install`, then copy
   `.env.example` to `.env` and fill in `INTEGRATION_LAYER_URL`, `CTP_PROJECT_KEY`,
   `CTP_AUTH_URL` (the auth host for your project's region), and the
   `CTP_CLIENT_ID` / `CTP_CLIENT_SECRET` from step 1. See [Config](#config).
3. **Author your extension.** Pick the [example template](#five-example-templates)
   closest to what you want to build and edit its `src/extension.ts`. You can develop
   against a live, queryable server with `pnpm dev` — see
   [Develop locally](#develop-locally-serve).
4. **Configure extension settings, if any.** If your extension reads runtime settings
   or secrets — e.g. the Algolia keys in `algolia-recommendations` — set them as your
   project's extension configuration; the resolver reads them from `ctx.config` at
   runtime (secrets are stored encrypted and never baked into the bundle). Templates
   that need no settings skip this step.
5. **Validate and publish.** From the example's directory, run `pnpm validate` to
   confirm it composes with your project, then `pnpm push` to publish it. The
   integration layer serves the updated extension right away — no redeploy.

The sections below cover each piece in more detail.

## Five example templates

This repository ships **five independent, project-agnostic example extensions**, each
a self-contained template showing one way a subgraph contributes to the supergraph:

| Example | Path | Pattern |
| --- | --- | --- |
| **server-time** | `examples/server-time` | A brand-new type + root field (`Query.serverTime`). Purely additive — shares nothing with the integration layer, so composition is trivial. |
| **loyalty-points** | `examples/loyalty-points` | A field on an EXISTING entity (`Product.loyaltyPoints`) via `@interfaceObject` — attaches to every product by its `id` without enumerating concrete product types. Computed from an *argument*, so it needs nothing from the product but its identity. |
| **price-discount** | `examples/price-discount` | A field on a nested object (`ProductPrice.discountedAmount`) computed from the object's OWN data — the price's `value.centAmount`, pulled in with `@requires`. Shows the next step beyond loyalty-points: depending on fields the integration layer owns, without re-declaring or resolving them. |
| **address-format** | `examples/address-format` | A field on a shared, embedded nested object (`Address.formatted`) computed via `@requires` from the address's own *scalar* fields — like price-discount but the required data is plain scalars on the type, not a nested value type. `Address` is shared across customer/BU/cart/order, so the field appears on every address. |
| **algolia-recommendations** | `examples/algolia-recommendations` | A field on an existing entity (`Product.recommendations`) that calls an EXTERNAL service — Algolia — using the **official `algoliasearch` SDK directly, with no special imports**. The runtime exposes a global `fetch` whose outbound requests are limited to an operator-configured allowlist of hosts (Algolia's by default). |

A developer **works inside one example**: edit its `src/extension.ts`, then run the
shared `build → validate → push` flow from that directory. The templates carry no
project config — the project a template is pushed to is supplied by the one shared
root `.env` (see Config), so any template can be pushed to any project.

> The object store holds **one bundle per project**, so pushing a second template to
> the same project **replaces** the first. The five examples are independent
> templates, not co-deployed — push one (per project) at a time, or each to its own
> project.

## Layout

```
integration-layer-extension-examples/
├── .env.example                 # the ONE shared target-project config (no template data)
├── eslint.config.js             # shared flat config; `pnpm lint` runs `eslint .` from here
├── packages/
│   └── tooling/                 # @example-extensions/tooling — the shared flow
│       ├── bin/ee-ext.mjs       #   the `ee-ext` bin (build|validate|push|serve)
│       ├── src/                 #   build · staticAnalysis · loadBundle · validateBundle
│       │                        #   · remoteValidate · compose · gateway · serve · push
│       │                        #   · ctToken · env · cli · index
│       └── tests/               #   build+validate pipeline + per-example smoke tests
└── examples/
    ├── server-time/             # @example-extensions/server-time
    │   └── src/extension.ts      #   the template (the only file you edit)
    ├── loyalty-points/          # @example-extensions/loyalty-points
    │   └── src/extension.ts
    ├── price-discount/          # @example-extensions/price-discount
    │   └── src/extension.ts
    ├── address-format/          # @example-extensions/address-format
    │   └── src/extension.ts
    └── algolia-recommendations/ # @example-extensions/algolia-recommendations
        └── src/extension.ts
```

The `ee-ext` bin (from the tooling package, on each example's PATH because each
example depends on it) resolves the template entry/outfile from the directory it is
run in (`<example>/src/extension.ts` → `<example>/dist/extension.js`) and loads the
shared root `.env` for the target project. So the same validated flow runs for
whichever example you stand in.

## The pipeline

```
examples/<name>  ──push──▶  integration layer            extensions runtime
  src/extension.ts          PUT /api/<project>/extensions   GET /api/<project>/extensions
  → esbuild → dist/         (per-project object store) ────▶ build subgraph + serve
  → validate (local+remote) ─▶                               + (re)publish SDL
```

1. Author the extension in an example's `src/extension.ts`. It exports an SDL string
   (`typeDefs`) and a `resolvers` object. **esbuild** bundles it (and any local
   helper modules it imports) into a single self-contained **CommonJS** module the
   runtime can load with no bundler; only `graphql` stays an external import (the
   host provides it). The runtime executes resolvers in a **restricted environment** —
   not a full Node runtime — so they have no ambient `process`, `fs`, or raw sockets.
   See the authoring constraints below.
2. `pnpm push` (from the example dir) builds `dist/extension.js`, **validates it**
   (see below) — both locally and against the integration layer — and, only if it
   passes (or you force it), `PUT`s it into the integration layer's object store
   (authenticating with a commercetools `manage_project` token — the route's trust
   boundary). A broken or breaking bundle fails here, never reaching the store.
3. The integration layer's runtime fetches the bundle from that store, serves the
   subgraph, and publishes its SDL to the schema registry. So editing the file +
   `pnpm push` changes the live extension with **no redeploy**.

## Usage

Repo-wide (run from the repo root):

```bash
pnpm install                    # install dev tooling (run once)
pnpm build                      # esbuild → each example's dist/extension.js
pnpm typecheck                  # tsc --noEmit across all packages
pnpm lint                       # eslint . (shared root config)
pnpm test                       # vitest — the build + validate + per-example tests

# Per-example validate/push (need a target project — see Config). From the root:
pnpm validate:server-time             pnpm push:server-time
pnpm validate:loyalty-points          pnpm push:loyalty-points
pnpm validate:price-discount          pnpm push:price-discount
pnpm validate:address-format          pnpm push:address-format
pnpm validate:algolia-recommendations pnpm push:algolia-recommendations
EE_FORCE=1 pnpm push:server-time   # push even if integration-layer validation fails
```

Or work **inside an example** (the intended day-to-day flow):

```bash
cp .env.example .env             # set the target project once
cd examples/server-time
pnpm build / pnpm validate / pnpm push
```

> `validate` and `push` talk to the integration layer, so they load the shared
> root `.env` (`INTEGRATION_LAYER_URL` + `CTP_*`). The plain
> `build`/`typecheck`/`lint`/`test` checks stay offline.

## Develop locally (`serve`)

`ee-ext serve` (per example `pnpm dev`, from the root `pnpm dev:<example>`) runs
the example as a **live, queryable GraphQL server** with esbuild watch and GraphiQL —
the inner loop the build → validate → push flow lacked. It builds the same bundle,
loads it, and serves an Apollo Federation v2 subgraph from its `typeDefs` +
`resolvers`, invoking those resolvers with the same capability `ctx` (`now`/`config`)
the runtime passes. Locally, `ctx.config` is sourced from `EXTENSION_CONFIG_*` env
vars instead of the integration layer. Edit `src/extension.ts` and the served schema
hot-reloads with no restart.

```bash
cd examples/loyalty-points

pnpm dev                       # standalone: the extension subgraph at :4000/graphql
pnpm dev --compose             # + the FULL merged schema (extension + integration layer)
pnpm dev --gateway             # /graphql becomes a federated gateway over both
pnpm dev --gateway --port 4005 # (pick a port)
```

> Pass flags from **inside the example** (`pnpm dev --gateway`). The root
> `pnpm dev:<example>` shortcut is for the default (flagless) mode — flags don't
> forward cleanly through its two pnpm layers.

- **standalone** (offline): query the extension's own fields directly; exercise
  entity-extension fields (e.g. `Product.loyaltyPoints`) through the federation
  `_entities` query.
- **`--compose`**: fetches the project's integration-layer subgraph SDL (the public
  `GET /api/<project>/subgraph`) and composes it with your extension — the same
  composition the integration layer runs on publish. Serves `/composed` (the
  client-facing merged schema, browsable but not executable) and `/schema.graphql` +
  `/supergraph.graphql` (SDL as text). A non-composable edit logs the exact federation
  collisions and keeps serving; saving a fix recomposes.
- **`--gateway`**: an **executable** federated gateway at `/graphql` (Apollo Gateway)
  that routes each field to its owner — so `{ product(id:…) { name
  loyaltyPoints(price:…) } }` resolves `name` from the integration layer and
  `loyaltyPoints` from your **local** extension in one request, the production
  topology in miniature. It mints an anonymous session for its integration-layer calls
  and serves the raw extension subgraph at `/_extension`.

> `--compose`/`--gateway` reach the project's integration layer; point
> `INTEGRATION_LAYER_URL` at your deployed integration layer (it must expose
> `GET /api/<project>/subgraph`). Standalone needs nothing.

## Config

The example templates are **project-independent** — they carry no project config. The
project a template is pushed to lives in the single shared root `.env` (copy
`.env.example`): `INTEGRATION_LAYER_URL`, `CTP_PROJECT_KEY`, `CTP_AUTH_URL`, and a
commercetools client with `manage_project`. To push a template elsewhere, point that
file at another project (or override `CTP_PROJECT_KEY` + its creds in the environment,
e.g. `CTP_PROJECT_KEY=… pnpm push`).

## Validation

`pnpm push` (and `pnpm validate`) gate on the built bundle before it can reach the
object store, in two layers.

**Local** (`packages/tooling/src/validateBundle.ts`) — offline, always enforced. It
checks only what the bundle author has and the remote layer can't see (the push sends
the integration layer the SDL only, never the bundle):

1. **static analysis** of the author's source — rejects the patterns that won't work
   at runtime: the ambient `process`, imports of Node built-ins (`fs`, `crypto`,
   `node:*`, …), and `eval`/`new Function`. This is a best-effort lint that catches
   honest mistakes early; it is not the security boundary (the runtime enforces that).
2. loads the built bundle and checks its **shape + coherence** — a non-empty
   `typeDefs` string, a `resolvers` object, and every resolver type/field declared by
   the SDL (a typo that would be a silent runtime no-op is rejected).

It does **not** compose the subgraph: composition is the remote layer's job (below),
which composes against the live integration layer exactly as it does on publish — an
offline standalone compose would be a strictly weaker, redundant duplicate.

**Remote** (`packages/tooling/src/remoteValidate.ts` → the integration layer's
`POST /api/<project>/extensions/validate`) — needs `.env`:

3. **composes the extension WITH the project's integration-layer subgraph**, exactly
   the two-subgraph composition performed on publish. This is the only place the
   extension is composed at all — it surfaces both malformed SDL and collisions with
   the integration layer (e.g. the extension declaring a type or field name that
   already exists with an incompatible shape);
4. **rejects breaking changes** versus the project's currently published schema — a
   removed or narrowed field that consumers depend on. The only no-baseline case is a
   project's **first** extension (nothing published yet, so nothing to break) — there
   step 3's composition check alone gates.

A failure aborts the push with a precise message listing the composition errors or
breaking changes. To upload anyway — e.g. a deliberate, coordinated breaking change —
force it:

```bash
EE_FORCE=1 pnpm push             # force via env var — the reliable form through the pnpm script chain
```

`push.ts` also honours a `--force`/`-f` flag when the `ee-ext` bin is invoked directly
(`ee-ext push --force`), but `EE_FORCE` is the form to use with the pnpm scripts — a
bare `--force` would be swallowed by pnpm itself. Force bypasses only the **remote**
verdict (steps 3–4); the local checks (1–2) always hard-fail — a bundle that won't
load, whose source reaches for unavailable features, or whose resolvers don't match
its SDL is broken regardless of intent.

The local pipeline — real esbuild build of fixture sources fed to the real validator,
happy path and every rejection, plus a per-example smoke test — is covered by
`packages/tooling/tests/*.test.ts` (`pnpm test`); the remote compose/breaking-change
logic is covered by the integration layer.

## Authoring constraints

An example's `src/extension.ts` (and any modules it imports) must:

- export exactly `typeDefs` (a federation-v2 SDL **string**, including the `@link` to
  the federation spec) and `resolvers` (a plain object);
- import **local helper modules** (esbuild inlines them into the single-file bundle),
  **npm SDKs** (also inlined — subject to the network note below), and, if needed,
  **`graphql`** — the one host-provided package the runtime supplies (e.g. to throw a
  `GraphQLError`). `graphql` is kept external, never inlined: a second copy of
  graphql-js would break its `instanceof` checks.
- run in a **restricted runtime** — not a full Node environment. Resolver code **must
  not** touch `process`/`process.env`, `fs`, `child_process`, or raw sockets — they
  are not available. It **may** use a standard web-platform surface, so an ordinary
  SDK works with no special imports: `fetch` (allowlisted — see below),
  `AbortController`, `setTimeout`/`clearTimeout`, `Date`, `Math`,
  `TextEncoder`/`TextDecoder`, `URL`.
- reach the network only via the global **`fetch`**, whose outbound requests are
  limited to an **operator-configured allowlist of hosts** (Algolia's by default);
  requests to anything else are refused before any socket opens. An SDK must be
  **fetch-based**: the bundler selects a package's `fetch`/`worker` build (the runtime
  provides no Node `http`/`https`), so a Node-`http`-only SDK won't work. Anything else
  a resolver needs comes through its **context** (the third resolver argument):
  - `ctx.now()` — current epoch-millis (a convenience; `Date.now()` works too);
  - `ctx.config` — the per-project `{ key: value }` config, secrets decrypted
    host-side. See `examples/algolia-recommendations`, which uses the official
    `algoliasearch` SDK over the global `fetch` and reads its keys from `ctx.config`.

  `pnpm validate` runs the static analysis above, so a source that reaches for an
  unavailable feature fails locally, not at load time.

The example templates show the ways a subgraph contributes, all composable with the
integration-layer subgraph:

- **own root fields / own types** — purely additive (`examples/server-time`:
  `Query.serverTime` + the `ServerTime` type). Nothing is shared, so composition is
  trivial.
- **a field on an existing entity** (`examples/loyalty-points`:
  `Product.loyaltyPoints`) — the integration layer exposes its top-level resources as
  Federation entities keyed by `id`, so a subgraph can attach a field to them. Import
  `@key` (and `@interfaceObject` where noted) in the `@link`, and re-declare only the
  key field:
  - **`Product`** is an entity *interface* — use `@interfaceObject` to attach a field
    to *every* product at once (e.g. `Product.loyaltyPoints`), without enumerating the
    concrete per-product-type objects.
    ```graphql
    type Product @key(fields: "id") @interfaceObject { id: ID!  loyaltyPoints(price: Float!): Int! }
    ```
  - **object entities** — `Cart`, `Order`, `Customer`, `BusinessUnit`, `Category`,
    `Quote`, `QuoteRequest`, `Review`, `Wishlist`, `PurchaseList`, `ApprovalFlow`,
    `ApprovalRule`, `RecurringOrder`, `RecurrencePolicy`, `AssociateRole` — use plain
    `@key` + `extend type`:
    ```graphql
    extend type Order @key(fields: "id") { id: ID!  priorityScore: Int! }
    ```

  Every entity is keyed by `id`. Every entity that **has a `key` field** is *also*
  keyed by `key`, so you may attach by the human-readable handle instead
  (`@key(fields: "key")` + re-declare `key`). `BusinessUnit` and `AssociateRole` have
  a non-null `key` (always present); on the others (`Product`, `Category`, `Quote`,
  `QuoteRequest`, `Wishlist`, `PurchaseList`, `ApprovalRule`, `RecurrencePolicy`)
  `key` is optional — keying by it is **your call as the author**: the field resolves
  only for instances that actually have a key (an instance with `key: null` can't be
  reached by that path, and a non-null extension field would null-propagate). Entities
  with no `key` field at all (`Cart`, `Order`, `Customer`, `Review`, `ApprovalFlow`,
  `RecurringOrder`) are keyed by `id` only.

  Only these entities are keyed. Value types (`Money`, images), reference wrappers
  (`*Ref`), embedded sub-objects (`LineItem`), and product *variants* (their `id` is a
  per-product `Int`, not a global key) are **not** entities and can't be extended this
  way.
- **a field on a nested object, computed from its own data** (`examples/price-discount`:
  `ProductPrice.discountedAmount`; `examples/address-format`: `Address.formatted`) — a
  few nested objects that aren't top-level resources are keyed too, purely so you can
  decorate them: currently **`ProductPrice`** (a product's price), keyed by `id`, and
  **`Address`** (a customer's/BU's/cart's/order's address), keyed by `id` *and* its
  `key` (so you may attach by the human-readable handle — e.g. `@key(fields: "key")` +
  re-declare `key` — instead of the opaque id). When the field you add needs the
  object's own data (owned by the integration layer), declare just those fields as
  `@external` and name them in `@requires`; the integration layer resolves them inline
  and the router hands them to your resolver, so you reference the data without owning
  or re-declaring it. The data may be a nested value type (a price's `value`)…
  ```graphql
  type Money { centAmount: Int! @external }
  type ProductPrice @key(fields: "id") {
    id: ID!
    value: Money! @external
    discountedAmount(percentOff: Int!): Int! @requires(fields: "value { centAmount }")
  }
  ```
  …or plain scalar fields on the object itself (an address's lines), which need no
  extra type:
  ```graphql
  type Address @key(fields: "id") {
    id: ID
    streetName: String @external
    city: String @external
    country: String! @external
    formatted: String! @requires(fields: "streetName city country")
  }
  ```
  These nested objects are *additive-only* — they're not genuine global entities, so
  (unlike the top-level entities) they're never a join target. Two caveats on
  `Address`: it is **shared** (one type, reached from customer/BU/cart/order — your
  field appears on every address), and its keys are declared **nullable** even though,
  on a customer or business-unit, the `id` is **mandatory** (assigned on add, so
  id-keying always resolves there). The nullable declaration is forced by the shared
  type also covering a cart/order inline address, which may have no `id` (it can carry
  only a `key`, or neither) — an address lacking the key you chose can't be reached by
  it, so the field null-propagates there. Key by `key` if you target inline addresses.
- **a field backed by an external service** — same `@interfaceObject` shape, but the
  resolver calls out over the network (`examples/algolia-recommendations`:
  `Product.recommendations` from Algolia) using the **official `algoliasearch` SDK**
  over the global `fetch` — no special imports; outbound requests are limited to the
  allowlist. The field is **nullable** so an upstream outage degrades to `null` rather
  than failing the whole product. Its Algolia App ID/index/search-key are read from
  `ctx.config` (the key a host-side `secret`) — keep the key search-only.
- **overriding a field + making the integration layer a join target** — the same
  `examples/algolia-recommendations` template also `@override`s the integration
  layer's `Query.productSearch`, so Algolia powers search at the federation edge. Its
  resolver returns only product **stubs** (`{ id }`, the Algolia `objectID` == the
  product id); the router then re-enters the integration layer by that key (the
  federation `_entities` query — the integration layer is a **join target** for
  `Product`) to fill in every other product field, so the result has the **exact same
  rich `Product` shape** the integration layer's own search returns.
  `@override(from: "integration-layer")` transfers the field's ownership. To
  `@override` the field you must also re-declare its argument/result types (federation
  has no cross-subgraph type import), taking **exclusive** ownership via field-level
  `@override(from: "integration-layer")` on every `ProductSearchResult`/facet field —
  so the extension is the sole resolver of the search result in the federated graph.
  (The integration layer still serves `productSearch` directly; `@override` only
  governs the routed supergraph.) Algolia drives `items`/`total`/`facets`;
  `facetDefinitions` (display labels derived from product types) stays empty.
  `integration-layer` is the federated subgraph name `@override(from: …)` references.

In all cases, do **not** redeclare/resolve fields the integration layer owns as your
own — a field you co-own needs `@shareable`, and composition rejects an unshared
duplicate. (`@external` is the opposite: it says "the integration layer owns this, I'm
only referencing it for `@key`/`@requires`" — that's why the `value`/`Money.centAmount`
above compose.)

`pnpm validate` enforces that whichever you do composes — against the live
integration-layer subgraph — before you push.

## Flow: a storefront product search through the Algolia override

When the `algolia-recommendations` extension is live, a storefront `productSearch` is
powered by Algolia at the edge (the `@override`) but the rich product detail still
comes from the integration layer (the federation join target). The router runs the
whole plan; the storefront sends one query and gets back the same `ProductSearchResult`
shape it always has.

```mermaid
sequenceDiagram
    autonumber
    participant SF as Storefront
    participant R as Router (federation edge)
    participant X as Extensions subgraph
    participant AL as Algolia
    participant T as Integration layer
    participant CT as commercetools

    SF->>R: POST /{project}/graphql<br/>productSearch(input){ items{ id name variants } total facets } + session bearer
    Note over R: Per-project planner. @override means productSearch<br/>is owned by the extensions subgraph.

    R->>X: productSearch(input)  (subgraph fetch)
    X->>AL: algoliasearch SDK → searchSingleIndex (over the global fetch)
    AL-->>X: hits[{objectID}], nbHits, facets
    X-->>R: ProductSearchResult{ items:[{id}], total, facets, facetDefinitions:[] }

    Note over R: items are bare Product stubs ({id}).<br/>Every other Product field is owned by the<br/>integration layer, so plan an _entities fetch.

    R->>T: _entities(representations:[{__typename:Product, id}])<br/>{ ... on ConcreteType { name variants } } (session bearer)
    Note over T: Resolves each id through a session/store/channel-scoped<br/>loader; picks the concrete per-product-type.
    T->>CT: product projections by id
    CT-->>T: product projections
    T-->>R: [ ConcreteType{ name, variants } ] (positional, null for misses)

    Note over R: Merge Algolia's items/total/facets with<br/>the integration layer's resolved Product fields.
    R-->>SF: ProductSearchResult (Algolia ranking + rich product detail)
```

The trust boundary stays in the integration layer: the `_entities` re-entry runs
through the same session-scoped loader as a direct `products(ids:)` read, and the
integration layer re-validates the URL's project against the session bearer — the
router's routing is a hint, not the boundary.
