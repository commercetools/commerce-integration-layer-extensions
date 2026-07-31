# commerce-integration-layer-extensions

Runnable templates and deep technical reference for writing extensions to the
commercetools Commerce Integration Layer.

This repo **complements** the [Commerce Integration Layer documentation][docs] — it doesn't
repeat it. The docs teach the model: what an extension is, the federation concepts, the
schema patterns, the entity catalog, the sandbox, and the publish flow. Start there.
Come back here for the code to edit, the details underneath the model, and the full CLI
reference.

> The Commerce Integration Layer is in public beta and its documentation is not yet on the
> public site. The `docs.commercetools.com/integration-layer/…` links below are the
> permanent home; until launch, read them on the preview host
> `cw-integration-layer-docs.preview-docs.commercetools.com`.

[docs]: https://docs.commercetools.com/integration-layer

## Read the documentation first

| Page | What it gives you |
| --- | --- |
| [Overview](https://docs.commercetools.com/integration-layer/overview) | concepts and terminology — sessions, router, extensions, enrollment |
| [Getting started](https://docs.commercetools.com/integration-layer/getting-started) | enroll a Project, mint a session, publish a first extension |
| [GraphQL federation](https://docs.commercetools.com/integration-layer/graphql-federation) | subgraphs, entities, keys, stubs, and the directives |
| [Choosing an extension type](https://docs.commercetools.com/integration-layer/extension-types) | schema extension vs API Extension vs Subscription |
| [Schema extensions](https://docs.commercetools.com/integration-layer/schema-extensions) | the authoring model: patterns, entity catalog, sandbox, config, publishing |
| [API Extensions](https://docs.commercetools.com/integration-layer/api-extensions) | validate, modify, or block a commercetools write |
| [Best practices](https://docs.commercetools.com/integration-layer/best-practices) | sessions, extension design, degradation |

## What this repo adds

| | |
| --- | --- |
| [`docs/authoring.md`](docs/authoring.md) | The details underneath the model: what `parent` really contains, opaque ids vs `_ctId`, the `@override` traps, keying by the readable `key`, the exact sandbox endowments and why each is withheld, the bundle lifecycle a `push` waits on, provenance, and what a request actually does |
| [`docs/cli.md`](docs/cli.md) | The `integration-layer` CLI plugin in full: every command and flag, how it authenticates, which of the three hosts each command talks to, the `--all` monorepo model, CI usage, and how to develop and release the plugin |
| [`examples/`](examples) | Nine standalone templates, one per pattern — edit `src/extension.ts` and push |
| [`packages/cli-topic-integration-layer`](packages/cli-topic-integration-layer) | The source of the published plugin itself |

## Quickstart

```bash
# Install the CLI and the integration-layer topic (once), then log in
npm install -g @commercetools/cli@dev
commercetools plugins install @commercetools/cli-topic-integration-layer
commercetools auth login --project-key <your-project-key>

# Get the templates
git clone https://github.com/commercetools/commerce-integration-layer-extensions
cd commerce-integration-layer-extensions && pnpm install

# Work inside the template closest to what you want
cd examples/server-time
pnpm dev                # live GraphiQL at :4000; edit src/extension.ts, hot-reloads
pnpm validate           # composes against YOUR Project, reports collisions and breaking changes
pnpm push               # builds + validates, then publishes; live immediately
```

Starting a real project rather than reading one? `commercetools integration-layer init`
scaffolds a workspace whose extensions merge into the single bundle a Project deploys —
see [the `--all` model](docs/cli.md#one-bundle-per-project-and---all).

Full install notes, including running an unreleased plugin from this checkout, are in
[`docs/cli.md`](docs/cli.md#install). Changing the plugin itself? Add a changeset — see
[Developing the plugin](docs/cli.md#developing-the-plugin).

## Templates

Each is self-contained: pick the closest one, edit its `src/extension.ts`, and run the
same `build → validate → push` flow from its directory. A bundle may export GraphQL
schema extensions (`typeDefs` + `resolvers`), commercetools API Extensions
(`apiExtensions`), or both.

| Template | Kind | Pattern |
| --- | --- | --- |
| **server-time** | schema | A brand-new type and root field (`Query.serverTime`) that shares nothing with the Commerce Integration Layer |
| **loyalty-points** | schema | A field on an entity computed from an *argument* (`Product.loyaltyPoints`) — no Project data read |
| **price-discount** | schema | A field computed from a nested value the Commerce Integration Layer owns, via `@requires` (`Product.discountedPrice`) |
| **customer-display-name** | schema | `@requires` over plain scalar fields (`Customer.displayName`) |
| **algolia-recommendations** | schema | An external service returning entity stubs (`Product.recommendations`), keyed by `_ctId` |
| **business-unit-cost-centres** | schema | Attaching by the READABLE key, on a non-`Product` entity (`BusinessUnit.costCentres`, `@key(fields: "key")`) |
| **category-counts-override** | schema | Taking over an existing field with `@override` (`Query.categoryProductCounts`) — including the per-field override the result type needs |
| **cart-sku-blocker** | API Extension + schema | BLOCK a write (`{ errors }`) *and* expose a `blockedSkus` query, from one shared config |
| **cart-quantity-cap** | API Extension | MODIFY a write in flight (`{ actions }`), API-Extensions-only, with a commercetools `condition` |

> A Project holds one bundle, so a second push replaces the first. Push one template per
> Project. To ship several patterns at once, merge their `typeDefs` / `resolvers` /
> `apiExtensions` — or use the [`--all` monorepo model](docs/cli.md#one-bundle-per-project-and---all).

## Scripts

From inside `examples/<name>` — the day-to-day loop:

```bash
pnpm dev        # extension serve (or, for cart-quantity-cap, extension invoke)
pnpm build      # bundle to dist/extension.js
pnpm validate   # local + remote validation
pnpm push       # build + validate + publish
```

From the repo root:

```bash
pnpm install                 # once
pnpm setup:cli               # build + link the vendored plugin (replaces the published one)
pnpm typecheck               # tsc --noEmit across every example
pnpm lint                    # eslint . (shared flat config)
pnpm build                   # build every example
pnpm test                    # the CLI plugin's vitest suite
pnpm changeset               # required in a PR that changes the CLI plugin
pnpm validate:<name>         # per-example, e.g. pnpm validate:server-time
pnpm push:<name>
```

`typecheck` and `lint` are offline. `build`, `dev`, `validate`, and `push` run through
the commercetools CLI; `validate` and `push` additionally need
`commercetools auth login`.

## Configuration

Authentication is `commercetools auth login` — there are no credentials in this repo.
`.env` (copy `.env.example`) holds only optional overrides:

| Var | What it is |
| --- | --- |
| `INTEGRATION_LAYER_URL` | Override the extensions edge. Normally unset — it's derived from your login Region ([details](docs/cli.md#which-host-each-command-talks-to)) |
| `EXTENSION_CONFIG_<KEY>` | Local-only: feeds `ctx.config.<KEY>` to `serve` and `invoke`, which have no Commerce Integration Layer to read config from ([details](docs/authoring.md#local-development)) |

To target another Project, log in with a different `--project-key`, or pass
`--project-key` to a command. `.env` is gitignored.

## Layout

```
commerce-integration-layer-extensions/
├── docs/
│   ├── authoring.md              # the details the docs site doesn't cover
│   └── cli.md                    # the CLI plugin reference
├── examples/<name>/src/extension.ts   # the templates (the only file you edit)
└── packages/cli-topic-integration-layer/   # the published CLI plugin
```

## Need Help?

In case you have any questions about or issues with the tools and components provided in this repository, please reach out to our [Support team](https://support.commercetools.com).
