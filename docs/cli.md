# The `integration-layer` CLI plugin

`@commercetools/cli-topic-integration-layer` adds the **`integration-layer` topic** to
the [commercetools CLI](https://github.com/commercetools/cli). It is the tool you
author, run, validate, publish, and inspect an extension with.

The [Commerce Integration Layer documentation][docs] introduces three of its commands in
passing. This is the full reference: every command, every flag, how it authenticates,
and which host each one talks to.

- [Install](#install)
- [How it authenticates](#how-it-authenticates)
- [Which host each command talks to](#which-host-each-command-talks-to)
- [Global flags](#global-flags)
- [One bundle per Project, and `--all`](#one-bundle-per-project-and---all)
- [Command reference](#command-reference)
- [Using it in CI](#using-it-in-ci)
- [Developing the plugin](#developing-the-plugin)

[docs]: https://docs.commercetools.com/integration-layer

## Install

The plugin is published to the **public npm registry** and installed on demand as a
runtime oclif plugin. It is never bundled into the base CLI, so no auth or scope
mapping is needed.

```bash
npm install -g @commercetools/cli@dev
commercetools plugins install @commercetools/cli-topic-integration-layer
commercetools auth login --project-key <your-project-key>
```

> **Why `@dev`.** The `plugins` command (`@oclif/plugin-plugins`) currently ships only
> in the CLI's dev prerelease; `@latest` predates it. Drop `@dev` once it is promoted.

To run an unreleased build from a checkout of this repo instead, `pnpm setup:cli`
builds the vendored plugin and `commercetools plugins link`s it. That **replaces** the
published plugin for your CLI until you `commercetools plugins unlink` it — it is not a
shortcut for `plugins install`.

## How it authenticates

There is no separate credential file and no client id/secret for the plugin. The bearer
is the token `commercetools auth login` already persisted to
`~/.commercetools/credentials`. Logging in mints a **`manage_project`** token and
records your target Project key and Region; the plugin reads all three back from that
file, reconstructing the principal with no network call.

Reading from **disk** rather than from the auth plugin's in-memory security context is
deliberate, and it is what makes `plugins install` work. `@commercetools/cli-plugin-auth`
keeps that context in a module-level static, so there is one per loaded copy of the
module. Installed via `commercetools plugins install`, this topic lands in the oclif data
directory with its own copy of the auth plugin — a second, distinct module instance.
`auth login`'s prerun hook fills the **host's** static; a read through the inherited
`getAuthentication()` would hit the data-dir copy's empty one and reject every logged-in
caller with "not logged in". Reconstructing the principal from the credentials file
depends on no cross-copy static identity, so it works either way.

Not logged in, an authenticated command fails immediately with
`not logged in — run 'commercetools auth login' first` rather than attempting the call.

| Needs a login | Runs offline |
| --- | --- |
| `explore`, `schema fetch`, `extension push`, `extension status`, `extension delete`, `config *` | `init`, `extension build`, `extension invoke-api-extension`, `extension create-api-extension-input`, `extension serve` (standalone) |

Two commands are conditional: `extension validate` needs a login only for its remote
half (`--skip remote` makes it fully offline), and `extension serve` needs one only
with `--compose`, `--gateway`, or `--all`, which reach the real Commerce Integration Layer.

## Which host each command talks to

The Commerce Integration Layer has **three** public hosts per Region, and the plugin derives all
of them from your login Region — you normally set nothing.

| Edge | Derived host | Serves | Override |
| --- | --- | --- | --- |
| Extensions | `https://extensions.integration-layer.<region>.commercetools.com` | the `manage_project` routes: `/<project>/subgraph`, `/<project>/extension/*`, config | `--integration-layer-url` / `INTEGRATION_LAYER_URL` |
| GraphQL (router) | `https://graphql.integration-layer.<region>.commercetools.com` | `/<project>/graphql` — where operations run | `--graphql-url` / `IL_GRAPHQL_URL` |
| Identity | `https://auth.integration-layer.<region>.commercetools.com` | `POST /<project>/session` — session minting, and the core subgraph the local gateway routes to | `--auth-url` / `IL_AUTH_URL` |

Set an override only to point somewhere that doesn't follow the production host
convention: a local edge (`http://localhost:8080`) or a staging zone. If the Region is
absent and no override is set, the command fails loudly with the expected URL shape
rather than guessing.

## Global flags

Available on every authenticated command (help group `COMMERCE INTEGRATION LAYER`):

| Flag | Env | Purpose |
| --- | --- | --- |
| `--integration-layer-url` | `INTEGRATION_LAYER_URL` | extensions edge base URL; overrides the Region-derived host |
| `--project-key` | — | act on a different Project than the logged-in one |

Every authenticated command, plus the offline `extension serve` and
`extension invoke-api-extension`, also takes `--env-file <path>` — a dotenv file loaded
before the command runs (default: `.env` in the cwd, if present). A variable already set
in the shell always wins; `INTEGRATION_LAYER_URL` and local `EXTENSION_CONFIG_*` values
can live there (see [local development](authoring.md#local-development)).

## One bundle per Project, and `--all`

A Project deploys exactly **one** bundle — one federation subgraph the router composes
with the core subgraph. A push replaces the previous bundle entirely.

That doesn't mean one file. `build`, `validate`, `push`, and `serve` all take `--all`,
which discovers every package under `./extensions/*` that has a `src/extension.ts`,
sorts them by name for a deterministic result, and **merges** their `typeDefs`,
`resolvers`, and `apiExtensions` into a single subgraph and a single artifact. Never
one bundle per package — that isn't the deployed shape.

```bash
commercetools integration-layer init my-extensions   # scaffolds exactly this layout
cd my-extensions
pnpm push                                            # → extension push --all
```

`--extensions-dir <dir>` (default `extensions`) points the discovery elsewhere. Two
extensions can each add fields to `Query`; they only clash if they declare the *same*
field.

`--entry` and `--out` keep the same meaning under `--all`, so a repo that doesn't use
the defaults stays consistent. `--out` names the single combined artifact (there is no
per-package output — that's the point of `--all`). `--entry` carries over as the
per-package **source segment** applied under each `./extensions/*`: the default
collapses to `src/extension.ts`, and `--entry src/main.ts` discovers and builds every
package from its own `src/main.ts`.

Without `--all`, every command operates on one extension, reading `src/extension.ts`
and writing `dist/extension.js` relative to the directory you run it in — which is why
the same commands work unchanged from inside any `examples/<name>`.

## Command reference

### `init`

```
commercetools integration-layer init [DIRECTORY] [--template basic] [-f]
```

Scaffolds an extensions monorepo: a pnpm workspace with the root scripts wired to the
`--all` flow, shared TypeScript and ESLint config, and one buildable `hello-world`
extension under `extensions/`. Everything is vendored inline — no network fetch.

| Argument / flag | Default | Notes |
| --- | --- | --- |
| `DIRECTORY` | `.` | the current directory when omitted |
| `--template` | `basic` | the only template today |
| `-f`, `--force` | `false` | scaffold into a non-empty directory |

Refuses a non-empty directory without `--force`. Offline.

### `extension build`

```
commercetools integration-layer extension build [--entry f] [--out f] [--all] [--extensions-dir d]
```

Bundles the extension into one self-contained CommonJS artifact with esbuild
(`graphql` stays external — see [the sandbox](authoring.md#the-sandbox-exactly)).
Offline; no login needed.

| Flag | Default |
| --- | --- |
| `--entry` | `src/extension.ts` |
| `--out` | `dist/extension.js` |
| `--all`, `--extensions-dir` | see [`--all`](#one-bundle-per-project-and---all) |

### `extension serve`

```
commercetools integration-layer extension serve [-p 4000] [--entry f] [--compose] [--gateway] [--all] [--auth-url u] [--env-file path]
```

A live GraphQL server with GraphiQL and esbuild watch, calling your resolvers with the
same `ctx` they get in production (`ctx.now()`, and `ctx.config` from
[`EXTENSION_CONFIG_*`](authoring.md#local-development) in the environment, a project
`.env`, or `--env-file`). When logged in and the Commerce
Integration Layer is reachable, resolver `fetch` is gated by the same project HTTP
allowlist as production (`allowlist list` / `allowlist add …`). Without login or when
offline, `fetch` is unrestricted locally (stderr warning). Save the extension source and
the schema reloads; save the `.env` / `--env-file` and `ctx.config` reloads too — both
with no restart (a shell variable still wins over the file). Three modes:

| Mode | `/graphql` is | Reaches the Commerce Integration Layer | Extra routes |
| --- | --- | --- | --- |
| default | your extension subgraph | no — fully offline | — |
| `--compose` | your extension subgraph | yes, for the SDL | `/composed` (browsable merged schema), `/schema.graphql`, `/supergraph.graphql` |
| `--gateway` | a federated gateway over your extension **and** the deployed Commerce Integration Layer | yes | `/_extension` (the raw subgraph) |
| `--all` | a gateway over the *merged* `extensions/*` subgraph and the Commerce Integration Layer | yes | `/_extension`, `/composed` |

In standalone mode, exercise entity fields such as `Product.loyaltyPoints` through the
`_entities` query. With `--gateway`, a query like
`{ product(id: …) { name loyaltyPoints(price: …) } }` resolves `name` upstream and
`loyaltyPoints` locally in one request — the production topology in miniature. It mints
an anonymous session for its upstream calls.

Under `--compose`, a non-composable edit logs the collisions and keeps the last good
schema up; fix and save to recompose.

> Pass flags from inside the example directory (`pnpm dev --gateway`). The root
> `pnpm dev:<example>` shortcut only covers the default mode — flags do not survive its
> two pnpm layers.

### `extension validate`

```
commercetools integration-layer extension validate [--skip local|remote] [--all] [--entry f] [--out f]
```

Runs the publish gate without uploading. Four checks, in order:

| # | Check | Where | `--force`able |
| --- | --- | --- | --- |
| 1 | Static analysis — rejects reaches for non-endowed globals (`process`, `node:*`, `eval`) | local | no |
| 2 | Shape and coherence — non-empty `typeDefs`, a `resolvers` object, a resolver for every field the SDL declares, and well-formed `apiExtensions`. A bundle must contribute at least one of the two kinds | local | no |
| 3 | Composition against your Project's live core subgraph | remote | yes |
| 4 | Breaking-change detection against your currently published schema | remote | yes |

`--skip local` and `--skip remote` run only one half. A Project's first extension has
no baseline, so check 4 doesn't apply to it. An API-Extensions-only bundle skips
composition — there's no schema to compose.

### `extension push`

```
commercetools integration-layer extension push [-f] [--all]
                                               [--source-revision r | --no-source-revision]
                                               [--no-wait] [--wait-timeout 180]
```

Build, validate, upload — replacing the Project's stored bundle.

| Flag | Default | Notes |
| --- | --- | --- |
| `-f`, `--force` | `false` | upload despite failing **remote** validation. The local checks always hard-fail: a bundle that won't load or whose resolvers don't match its SDL is broken whatever you intended |
| `--source-revision` | detected from git | env `EXTENSION_SOURCE_REVISION`. See [recording a revision](authoring.md#recording-which-revision-is-deployed) |
| `--no-source-revision` | `false` | push without recording one |
| `--wait` / `--no-wait` | `--wait` | wait for the extension runtime to load the pushed version and report back |
| `--wait-timeout` | `180` | seconds before giving up. The push still stands |

**The wait is the point.** A push only stores the bundle; the runtime loads it on its
own poll. Waiting is what catches a bundle that stores cleanly and then refuses to run —
see [what happens after `push`](authoring.md#what-happens-after-push). A `failed`
verdict exits non-zero; "couldn't find out" never does.

> Running through a package script, forward flags explicitly:
> `pnpm push -- --force`. A bare `pnpm push --force` may be swallowed by pnpm.

### `extension status`

```
commercetools integration-layer extension status
```

The Project's stored bundle: version, size in bytes, upload time, filename, who
updated it, and `built from` when the push recorded a revision. It reports the stored
bundle, not the [lifecycle state](authoring.md#what-happens-after-push) — that verdict
comes from the wait at the end of a `push`.

### `extension delete`

```
commercetools integration-layer extension delete [-y]
```

Removes the extension subgraph from the Project's published graph. Prompts unless
`-y`/`--yes`.

### `extension invoke-api-extension`

```
commercetools integration-layer extension invoke-api-extension --input file.json [--key k]...
                                                               [--all] [--config KEY=VALUE]... [--env-file path]
commercetools integration-layer extension invoke-api-extension --deployed --input file.json [--project-key key]
```

Fires a commercetools callback at the [API-Extension][apiext] handlers and prints the
decision — `APPROVE`, `MODIFY` with the actions, or the blocking errors. Two targets:

- **local (default)** — runs the bundle's handlers **in-process**. No deploy, no
  credentials, fully offline. Each handler is reported separately (`--key` narrows to
  named ones), and `ctx.config` comes from `EXTENSION_CONFIG_*` in the environment /
  `.env` / `--env-file` (a `--config` entry overrides the same key).
- **`--deployed`** — fires the callback at the project's **deployed** extension through
  the Commerce Integration Layer, exercising the LIVE code commercetools calls on a
  write. Needs a `commercetools auth login` (the connector's callback is signed with a
  shared secret only the integration layer can mint, so the integration layer proxies
  and signs the call). **Nothing is persisted** — it is the callback in isolation.

`--input` is required for both: a JSON commercetools `ExtensionInput` with both `action`
and `resource` (including `resource.typeId`). Use [`extension create-api-extension-input`](#extension-create-api-extension-input)
to scaffold a realistic payload. A handler fires only when its `resourceTypeId` and
`actions` match the payload — locally, others are reported as skipped.

`--deployed` uses the deployed code and the project's **stored** config, and returns the
connector's **single merged verdict** (there is no per-handler breakdown on the deployed
path), so it can't be combined with the local-bundle flags `--all`, `--extensions-dir`,
`--entry`, `--out`, `--config`, or `--key`.

| Flag | Default |
| --- | --- |
| `--input` | **required** — path to a JSON `ExtensionInput` (`{ action, resource }`) |
| `--deployed` | fire at the project's DEPLOYED extension via the Commerce Integration Layer (needs login); local (in-process) otherwise |
| `--key` | — repeatable; only invoke handlers with these keys (local only) |
| `--all`, `--extensions-dir` | invoke the merged bundle — see [`--all`](#one-bundle-per-project-and---all) (local only) |
| `--config` | repeatable `KEY=VALUE`, becomes `ctx.config` (overrides env / `.env`; local only) |
| `--env-file` | optional dotenv path (default: load `.env` from cwd if present) |
| `--project-key`, `--integration-layer-url` | `--deployed` only — override the login's project / IL edge |

```bash
commercetools integration-layer extension create-api-extension-input --resource-type cart --action Create --out ./payloads/cart-create.json
commercetools integration-layer extension invoke-api-extension --input ./payloads/cart-create.json
commercetools integration-layer extension invoke-api-extension --input ./payloads/cart-update.json --config MAX_LINE_QUANTITY=10
commercetools integration-layer extension invoke-api-extension --input ./payloads/order-create.json --key order-tagger
# Against the LIVE deployed extension (nothing is persisted):
commercetools integration-layer extension invoke-api-extension --deployed --input ./payloads/cart-create.json
```

Locally, errors out if the bundle declares no `apiExtensions`. With `--deployed`, errors
if the project isn't enrolled or its extension isn't deployed (no deployment / no service
URL yet).

[apiext]: https://docs.commercetools.com/integration-layer/api-extensions

### `extension create-api-extension-input`

```
commercetools integration-layer extension create-api-extension-input --resource-type cart|order|… [--action Create|Update] [--out file.json] [--id id]
```

Writes a realistic commercetools `ExtensionInput` JSON sample for local handler testing.
Supported resource types and enum field values come from `@commercetools/platform-sdk`
(`ExtensionResourceTypeIdValues`, `CartStateValues`, `OrderStateValues`, …). The output
matches what [`extension invoke-api-extension`](#extension-invoke-api-extension)
expects: a `{ action, resource }` object whose `resource.obj` carries the fields a handler
typically reads (line items on carts/orders, `amountPlanned` on payments, and so on).

| Flag | Default |
| --- | --- |
| `--resource-type` | **required** — from the SDK's `ExtensionResourceTypeIdValues` (`cart`, `order`, `payment`, …) |
| `--action` | `Create` (or `Update`; Update samples carry `version: 2`) |
| `--out` | — write to this file; omit to print JSON to stdout |
| `--id` | `sample-<resource-type>-id` |

```bash
commercetools integration-layer extension create-api-extension-input --resource-type cart --action Create --out ./payloads/cart-create.json
commercetools integration-layer extension create-api-extension-input --resource-type order --action Update
```

### `explore`

```
commercetools integration-layer explore [-p 4000] [--deployed] [--as email]
                                        [--locale l] [--currency c] [--country co]
                                        [--graphql-url u] [--auth-url u]
```

A local GraphQL explorer for your Project's **deployed** edge. One command: it resolves
the schema, mints a session from your existing login, serves GraphiQL on
`http://localhost:4000`, and proxies every operation to the real endpoint. No tokens to
paste, no headers to hand-edit.

| Flag | Purpose |
| --- | --- |
| `--deployed` | render the Project's **deployed composed schema** (read from the registry — core subgraph plus whichever extension is actually deployed) instead of composing locally |
| `--as <email>` | run operations as that customer, via an ordinary email/password login. Prompts for the password, or set `IL_CUSTOMER_PASSWORD`. Omit to run anonymously |
| `--locale`, `--currency`, `--country` | presentment, applied at mint (the only place it can be chosen). Default to the Project's |
| `-p`, `--port` | default `4000` |
| `--graphql-url`, `--auth-url` | override the router and identity edges for staging zones |

**Two schema sources.** By default it composes locally: your Project's core-subgraph
SDL plus, when you run it from an extension directory, that extension built from the
working tree — so your fields show up before you have pushed anything. `--deployed`
reads what the router actually serves, which is what you want when debugging the real
edge rather than your own draft.

**Auth has no back door.** Operations run as an anonymous shopper or as a real customer
who logs in with their own credentials. There is no impersonation flag and no
privileged debug identity — to see what a customer sees, you log in as them.

**Operations are attributed to the CLI.** The proxy stamps `graphql-client-name` and
`graphql-client-version` on every operation it forwards, so usage reporting shows
explorer traffic as coming from the CLI at its version rather than an unknown client.
Useful when you're reading your Project's usage and wondering which queries were you
poking around.

**The explorer page loads GraphiQL from a public CDN.** The HTML shell the CLI serves
on localhost pulls GraphiQL, React and their styles from [esm.sh](https://esm.sh) at
version-pinned URLs with subresource integrity, rather than vendoring a bundled copy
into the plugin. So `explore` needs outbound access to `esm.sh` in the browser, and it
won't render on a fully air-gapped machine — the CLI half still works, it's the page
that won't load. Nothing about your Project goes to the CDN: it serves static assets
only, and every GraphQL operation goes to your own edge through the local proxy.

**Introspection is answered locally.** The deployed edge has introspection disabled (a
Project's schema is not public), so the explorer reads the schema over an authenticated
API and answers GraphiQL's introspection itself. You get full docs and autocomplete
against an edge that gives no schema away; only real operations are forwarded, and the
session bearer is attached by the CLI on the way out — never exposed to the browser
page.

### `allowlist`

```
commercetools integration-layer allowlist list
commercetools integration-layer allowlist add    <HOST...>
commercetools integration-layer allowlist remove <HOST...> [--force]
commercetools integration-layer allowlist set    <HOST...> [--force]
```

The hosts your extension's sandboxed `fetch` is permitted to reach. A resolver calling
anything not on this list is refused before the socket opens, so adding the host is a
prerequisite for any external-service extension — see
[a field backed by an external service][extsvc].

A host pattern is either exact (`api.vendor.com`) or a suffix wildcard
(`*.algolia.net`). All three write commands are variadic, so you can pass several at
once:

```bash
commercetools integration-layer allowlist add api.vendor.com '*.algolia.net'
```

Quote the wildcard — otherwise your shell expands it.

| Command | Effect |
| --- | --- |
| `list` | print the allowed hosts, plus any operator denials |
| `add` | read-modify-write: merges the given hosts into the existing list |
| `remove` | read-modify-write: drops the given hosts, keeping the rest |
| `set` | **replaces the entire list** with the hosts given (at least one required) |

`remove` and `set` are destructive, so they prompt for confirmation; `--force` skips
it. Without a TTY they refuse outright rather than guessing, so a CI invocation must
pass `--force` explicitly.

**The operator denylist wins.** A host resolves only if it matches the allowlist **and**
does not match the operator's denylist. `list` prints denials for information — they're
read-only from here, so a host you have allowed can still be blocked above you.

[extsvc]: https://docs.commercetools.com/integration-layer/schema-extensions

### `schema fetch`

```
commercetools integration-layer schema fetch [--out f]
```

Prints the Project's core-subgraph SDL — the input your extension composes against — to
stdout, or writes it to a file. Useful for editor autocompletion, and for diffing what
changed under you.

### `config`

```
commercetools integration-layer config list
commercetools integration-layer config get <KEY>
commercetools integration-layer config set <KEY> <VALUE> [--secret]
commercetools integration-layer config unset <KEY>
```

The Project's extension configuration — what your resolvers read as `ctx.config`.
`--secret` seals the value: encrypted at rest, write-only thereafter, never returned by
a read and never written into your bundle. `list` and `get` mask secret values.

Configuration changes take effect on their own; you do not republish the bundle. For
the REST equivalent, see [the configuration endpoint](authoring.md#the-configuration-endpoint).

### `--version`

```
commercetools integration-layer --version        # -v also works
```

Prints the installed plugin's `name/version` — the plugin's own, not the host CLI's,
which is what you want when checking whether a `plugins install` actually picked up a
new release. Bare `commercetools integration-layer` still shows the topic help.

## Using it in CI

```bash
commercetools auth login --project-key "$CTP_PROJECT_KEY"     # or a manage_project client
EXTENSION_SOURCE_REVISION="$BUILD_ID" \
  commercetools integration-layer extension push --all --wait-timeout 300
```

- `push` waits for the load verdict by default and exits non-zero on a genuine
  `failed`, so a green pipeline means the bundle actually runs — not just that it
  uploaded. Keep the wait; raise `--wait-timeout` on a slow cold start instead.
- Set `EXTENSION_SOURCE_REVISION` when the checkout isn't a full git working copy, so
  the recorded revision is your build id rather than nothing.
- Reserve `--force` for a coordinated breaking change. It never bypasses the local
  checks.

## Developing the plugin

The plugin lives in this repo at `packages/cli-topic-integration-layer`.

```bash
pnpm install
pnpm --filter @commercetools/cli-topic-integration-layer build       # tsc → dist/
pnpm --filter @commercetools/cli-topic-integration-layer test        # vitest
pnpm typecheck
pnpm lint

pnpm setup:cli    # build + `commercetools plugins link` this checkout
pnpm changeset    # describe a plugin change for the next release (see below)
```

`@commercetools/cli-plugin-auth` is an ordinary **dependency**. It used to be a peer, to
force the plugin onto the host CLI's single copy of the auth module; now that the
principal is [read from the credentials file](#how-it-authenticates) instead of a shared
static, a second copy is harmless.

### Releasing

Only `@commercetools/cli-topic-integration-layer` is published — the `examples/*` are
`private`. Versioning and the changelog are driven by
[Changesets](https://github.com/changesets/changesets):

1. **In your PR**, add a changeset:

   ```bash
   pnpm changeset
   ```

   Pick the bump (`patch` / `minor` / `major`) and write a one-line summary — it becomes
   the CHANGELOG entry. Commit the generated `.changeset/<name>.md`. A PR that doesn't
   touch the plugin (docs, an example-only edit) needs none.

2. **On merge to `main`**, `.github/workflows/publish-release.yml` runs Changesets. With
   pending changesets it opens or updates a **"Version Packages"** PR that bumps
   `package.json` and writes the CHANGELOG. Nothing is published yet.

3. **Merging that PR** re-runs the workflow with no pending changesets, so it runs
   `changeset publish` — publishing to the public npm registry via npm Trusted Publishing
   (OIDC, no stored token) and pushing the per-package tag.

Two constraints explain why the workflow looks the way it does. `npm publish` must run
**in that one file**, because npm's trusted publisher is bound to the workflow filename —
a reusable or `workflow_call` split would make npm validate the *calling* workflow and
break the binding. And the Version Packages commit is created through the GitHub API
(`commitMode: github-api`) so GitHub signs it: the repo ruleset requires verified
signatures, and a local git commit would be rejected. Changesets' publish tags are
lightweight, so they don't hit that rule.
