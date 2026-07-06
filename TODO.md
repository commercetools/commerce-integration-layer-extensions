# integration-layer-extension-examples — deferred work

## Give the API-Extension authoring API a proper home (option "B")

### Where we are now (option "C" — inline)

The old `packages/tooling` (`ee-ext`) was **both** a CLI *and* an importable library.
It's been replaced by the published **`commercetools integration-layer` CLI plugin**
(`@commercetools-internal/cli-topic-integration-layer`), installed globally, which
gives full parity on the *commands* (`build`/`validate`/`push`/`serve`/`invoke` + more).

The one thing an oclif plugin doesn't naturally provide is an **import surface** for
the API-Extension authoring helpers (`defineApiExtension` / `approve` / `block` /
`update`) and their types (`ExtensionContext`, `ExtensionInput`, …). For now the one
API-Extension example (`examples/cart-sku-blocker`) **inlines the raw runtime
contract** instead — no helpers, no shared types:

```ts
import type { Cart, ExtensionInput } from '@commercetools/platform-sdk';

export const apiExtensions = [{
  key: 'cart-sku-blocker', resourceTypeId: 'cart', actions: ['Create', 'Update'],
  handler: (input: ExtensionInput, ctx: { now(): number; config: Record<string, string> }) =>
    offending ? { errors: [{ code: 'InvalidInput', message: '…' }] } : {},
}];
```

The GraphQL-subgraph examples export plain `typeDefs`/`resolvers` and import nothing,
so they're unaffected.

### Why not A (import the helpers from the CLI plugin)

The plugin *does* re-export the helpers/types from its package `main`, so a first
attempt (option "A") had `cart-sku-blocker` take the plugin as a devDependency and
`import { defineApiExtension, approve, block } from
'@commercetools-internal/cli-topic-integration-layer'`. **It was reverted** — two
concrete problems, both proven in practice:

- **It drags the plugin's entire runtime dependency tree into the example.** The
  plugin depends on `@apollo/composition|gateway|subgraph`, `@envelop/apollo-federation`,
  `graphql-yoga`, `esbuild`, the `@graphql-tools/*` stack, `protobufjs`, … — all
  installed just to use four pure functions and a couple of types.
- **It trips pnpm's `minimumReleaseAge` supply-chain policy.** Each octolog deploy
  stamps a fresh `0.1.0-<sha>`; relocking to it lands that build **and** several
  freshly-published transitive deps that are <24h old, so `pnpm install` rejects the
  lockfile (observed: the plugin + 4 `@graphql-tools/*` + `@protobufjs/utf8`). That
  blocks local installs and risks `--frozen-lockfile` in CI for ~24h after every
  relock.

### Why B (a standalone authoring SDK)

The clean fix is a **dedicated, minimal SDK package** exporting just the helpers +
types, versioned on a normal semver line and carrying (near-)zero runtime deps. That
restores full ee-ext-parity authoring **without** pulling the CLI's dependency tree
and **without** the moving-`latest` / age-gate churn — an example adds a small
`^x.y.z` devDep and imports `defineApiExtension`/`approve`/`block` + `ExtensionContext`.

### How to migrate to B

The authoring API is one self-contained module (the plugin's
`src/lib/tooling/apiExtension.ts` — its only external reference is a *type-only*
import of `ExtensionInput`/`ExtensionAction` from `@commercetools/platform-sdk`), so
this is a copy-move, not a refactor:

1. **Create the SDK package** (alongside the plugin in `commercetools/cli`, or
   wherever the plugin lives): move `apiExtension.ts` into it, export the same surface
   (`defineApiExtension`, `approve`, `block`, `update` + the types), keep its
   dependencies minimal (ideally only a type-only `@commercetools/platform-sdk`),
   give it a real semver version, and publish it. Have the CLI plugin depend on the
   SDK and re-export from it so the CLI and the SDK can't drift.
2. **Repoint `cart-sku-blocker`** (the only API-Extension example): replace the inline
   raw contract with imports from the SDK (`defineApiExtension`/`approve`/`block` +
   `ExtensionContext`), and add the SDK as a devDependency (`^x.y.z` — a real range,
   since the SDK is a small package published on a normal line, not a `0.x-<sha>`
   prerelease). `defineApiExtension` then types the handler `(input, ctx)` again, so
   the hand-written annotations go away. (If the set of API-Extension examples grows,
   a one-line re-export shim under `examples/` would let future swaps touch one file.)
3. **Regenerate the lockfile** (`pnpm install`, authed) and verify `pnpm build` /
   `pnpm typecheck` across the examples. With a minimal SDK there's no plugin dep tree
   and no fresh-transitive-dep age-gate to fight.
4. **Optional — make the plugin CLI-only.** Once nothing imports the plugin as a
   library, drop the `main` re-export of the authoring API from the plugin so it's
   purely commands. Safe: the only importers would be this repo's examples (repointed
   to the SDK) and posti-demo (which uses CLI commands only, imports nothing).
