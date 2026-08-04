# @commercetools/cli-topic-integration-layer

## 0.9.0

### Minor Changes

- a465eca: Add `extension invoke-api-extension --deployed`: fire the API-Extension callback at the project's DEPLOYED extension (the LIVE code commercetools calls on a write) through the Commerce Integration Layer, instead of running the local bundle in-process. Only the integration layer can sign the connector's `/api-extensions` callback (the shared secret is derived from the project's stored client secret and never leaves the server), so `--deployed` posts the payload to a new IL signing-proxy route and prints the connector's verdict; **nothing is persisted** to commercetools. It requires a `commercetools auth login`, uses the deployed code + the project's stored config, and returns the connector's single merged verdict — so it can't be combined with the local-bundle flags (`--all`, `--extensions-dir`, `--entry`, `--out`, `--config`, `--key`). Local (default) invocation is unchanged.

  Requires the companion Commerce Integration Layer route (`POST /:projectKey/extension/api-extensions/invoke`).

- c04939e: Add `extension serve-api-extension` for local end-to-end debugging of commercetools API Extensions. It serves the bundle's `apiExtensions` handlers over HTTP (in plain Node, so breakpoints work) and dynamically registers a commercetools API Extension pointing at a tunnel you supply with `--public-url`, so a real cart/order write in the Project calls the code on your machine. Editing the source hot-reloads the handlers and re-registers on a changed trigger.

  The command is deliberately conservative: before registering it **refuses** if an existing Extension already triggers on the same resource + action it would register (a collision, which commercetools rejects anyway) — unrelated Extensions are left untouched. It owns everything it creates under the `il-localdev-` key prefix and deletes those on exit; `--cleanup` sweeps leftovers from a crashed run. Point it at a dedicated dev/sandbox Project.

  Like `serve`/`build`/`push`, it supports `--all`: in a monorepo of `extensions/*` packages it builds, watches, and serves the one combined bundle a Project deploys (every package's `apiExtensions` concatenated) and registers the whole set, re-merging on any package's edit. Each API-Extension `key` must be unique across packages.

## 0.8.0

### Minor Changes

- 9fa0fef: `init` now scaffolds a colocated Vitest test for the starter extension (`extensions/hello-world/src/extension.test.ts`) that calls the resolver directly against a minimal fake context. The generated `hello-world` package gains a `test` script (`vitest run`) plus `vitest` as a dev dependency, and the root gains a `pnpm test` script that fans the suites out across every extension (`pnpm -r test`). The README and CLI docs document the pattern so a copied extension stays testable out of the box.

## 0.7.0

### Minor Changes

- 9f43362: Make `--entry` consistent across `--all`. `build`, `validate`, and `push` now honour `--entry` in `--all` mode, applying it as the per-package source segment under each `./extensions/*` (the default still collapses to `src/extension.ts`, so `--entry src/main.ts` discovers and builds every package from its own `src/main.ts`). `extension serve` gains the same `--entry` flag, honoured in both standalone and `--all` mode. `--out` was already the single combined-artifact path under `--all` and is unchanged.
- f87e610: Generalise `extension invoke-api-extension` beyond cart callbacks: `--input` (required) supplies a full commercetools `ExtensionInput`; `--key` (repeatable) restricts invocation to named handlers; `--all`/`--extensions-dir` invoke the merged bundle. Add `extension create-api-extension-input`, which derives supported resource types and enum values from `@commercetools/platform-sdk` and scaffolds realistic `{ action, resource }` JSON for local handler testing.
- 2bec63f: Load a project `.env` (or `--env-file <path>`) before commands run, so `INTEGRATION_LAYER_URL` and local `EXTENSION_CONFIG_*` values work without exporting them in the shell (a variable already set in the environment still wins). `extension serve` additionally **hot-reloads** that file — editing an `EXTENSION_CONFIG_*` value updates `ctx.config` for the next request with no restart — and `extension invoke-api-extension` reads the same `EXTENSION_CONFIG_*` (env / `.env` / `--env-file`) for its `ctx.config`, with `--config` overriding a given key.
- c2feacc: Rename `extension invoke` to `extension invoke-api-extension`. The command only ever fired a sample cart callback at a bundle's `apiExtensions` handlers (never the GraphQL half), so the old name didn't say what it invoked. Behaviour and flags are unchanged; update any script or CI step that called `extension invoke`.

### Patch Changes

- 54eda06: Refresh the `manage_project` bearer automatically instead of failing once it expires. Commands now authenticate like any other topic — a `prerun` hook fills this copy's security context from `~/.commercetools/credentials`, and every call goes through a `CtpAuthFetchFactory` fetch that injects the token and transparently refreshes/retries it. This removes the bespoke on-disk token reading and fixes `GET extension/bundle/meta failed (401): Bearer token is inactive or unknown` after a login goes stale.

## 0.6.0

### Minor Changes

- 49ec8c4: `extension serve` gates resolver `fetch` with the project's HTTP allowlist when logged in and the Commerce Integration Layer is reachable. Without login or when offline, fetch is unrestricted locally (stderr warning).

## 0.5.1

### Patch Changes

- 79173d3: `extension validate` and `extension push` no longer reject a bundle whose only
  contribution is a capability the runtime dispatches directly rather than through the
  schema. Such a bundle adds nothing to the SDL, so it was failing the "must export
  `typeDefs` and/or `apiExtensions`" shape check even though it is complete and
  deployable. A bundle that contributes nothing at all is still rejected.

## 0.5.0

### Minor Changes

- 21d3372: Add `integration-layer allowlist` commands to view and manage the extension HTTP allowlist — the hosts the extension sandbox's `fetch` may reach. `list` shows the merchant `allow` patterns plus the operator `deny` ceiling; `add`/`remove` amend the allow list, and `set` replaces it wholesale (requiring at least one host). `set` and `remove` show the current and proposed allow lists and ask for confirmation (`--force` skips). Backed by the Commerce Integration Layer's `GET`/`PUT /<project>/extension/allowlist` routes under the `manage_project` login.
- 409f182: Remove the placeholder `integration-layer hello` command; it only printed a hello-world message and served no real purpose.

### Patch Changes

- 60b6110: Documentation only. The package README is now a self-contained npm card that lists every command (including `serve`, `invoke`, `explore`, `--all` and `--version`) and links to the new CLI reference and authoring guide, replacing a stale link to a file that doesn't exist and instructions for `pnpm ilc:*` scripts from another repo. The README `integration-layer init` scaffolds is trimmed to project-specific setup and points at the Commerce Integration Layer documentation instead of restating it.

## 0.4.0

### Minor Changes

- ac39dfb: `commercetools integration-layer --version` (`-v`) now prints the installed plugin version; running the topic with no flag still shows its help.

## 0.3.1

### Patch Changes

- bc63353: Fix "not logged in" when the topic is installed via `oclif plugins install`. The
  topic now reads the logged-in principal from `~/.commercetools/credentials` via its
  own `FileBasedAuthenticationRepository` instead of the auth plugin's in-memory
  security context, so it no longer matters that an out-of-tree plugin install loads a
  second, empty copy of `@commercetools/cli-plugin-auth`. That package moves from a peer
  to a regular dependency accordingly.

## 0.3.0

### Minor Changes

- b261d5c: `integration-layer init` now defaults to the current directory when the target is empty, so you can scaffold an extension in place without passing a path.

### Patch Changes

- b261d5c: Fix `integration-layer extension serve --gateway`/`--all` so it reaches `/session` and the core GraphQL on the identity edge.
