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

[docs]: https://docs.commercetools.com/commerce-integration-layer

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
| `explore`, `schema fetch`, `extension push`, `extension status`, `extension serve-api-extension`, `config *` | `init`, `extension build`, `extension invoke-api-extension`, `extension create-api-extension-input`, `extension serve` (standalone) |

Two commands are conditional: `extension validate` needs a login only for its remote
half (`--skip remote` makes it fully offline), and `extension serve` needs one only
with `--compose`, `--gateway`, or `--all`, which reach the real Commerce Integration Layer.

## Which host each command talks to

The Commerce Integration Layer has **three** public hosts per Region, and the plugin derives all
of them from your login Region — you normally set nothing.

| Edge | Derived host | Serves | Override |
| --- | --- | --- | --- |
| Extensions | `https://extensions.integration-layer.<region>.commercetools.com` | the `manage_project` routes: `/<project>/main/subgraph`, `/<project>/main/extension/*`, config | `--integration-layer-url` / `INTEGRATION_LAYER_URL` |
| Experience API (router) | `https://graphql.integration-layer.<region>.commercetools.com` | `/<project>/main/graphql` — the shopper GraphQL API, where operations run | — |
| Identity API | `https://auth.integration-layer.<region>.commercetools.com` | `POST /<project>/main/session` — session minting, and the core subgraph the local gateway routes to | — |

The Experience and Identity edges are always derived from your login Region — there is
no override. If the Region is absent the command fails loudly with the expected URL
shape rather than guessing. The Extensions edge can be pointed elsewhere (a local edge
or a staging zone) with `--integration-layer-url` / `INTEGRATION_LAYER_URL`.

## Global flags

Available on every authenticated command (help group `COMMERCE INTEGRATION LAYER`):

| Flag | Env | Purpose |
| --- | --- | --- |
| `--integration-layer-url` | `INTEGRATION_LAYER_URL` | extensions edge base URL; overrides the Region-derived host |
| `--project-key` | — | act on a different Project than the logged-in one |

Every authenticated command (including `extension serve-api-extension`), plus the offline
`extension serve` and `extension invoke-api-extension`, also takes `--env-file <path>` — a dotenv file loaded
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
extension under `extensions/` with a colocated Vitest test (`src/extension.test.ts`)
that calls its resolver directly. Run the suites with `pnpm test` (per-package or from
the root). Everything is vendored inline — no network fetch.

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
commercetools integration-layer extension serve [-p 4000] [--entry f] [--compose] [--gateway] [--all] [--env-file path]
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

Build, validate, upload — replacing the Project's stored bundle. A push is how a
published extension changes: there is no command to unpublish one. Dropping the
bundle means removing the Commerce Integration Layer from the Project and setting
it up again.

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

[apiext]: https://docs.commercetools.com/commerce-integration-layer/api-extensions

### `extension serve-api-extension`

```
commercetools integration-layer extension serve-api-extension --public-url <url> [-p 4000]
                                                              [--config KEY=VALUE]...
                                                              [--all] [--extensions-dir extensions]
                                                              [--entry f] [--out f] [--cleanup] [--env-file path]
```

Local **end-to-end** debugging for [API Extensions][apiext] — the online counterpart to
the offline `invoke-api-extension`. It serves the bundle's `apiExtensions` handlers over
HTTP and registers a commercetools API Extension pointing at them, so a **real** cart/order
write in the Project calls the code on your machine (in plain Node — attach a debugger,
set breakpoints). Editing `src/extension.ts` hot-reloads the handlers, and a changed
trigger/condition re-registers automatically.

commercetools must reach a public HTTPS URL, so run your own tunnel and pass its address:

```bash
ngrok http 4000                                    # in one terminal → https://abc123.ngrok.app
commercetools integration-layer extension serve-api-extension --public-url https://abc123.ngrok.app
# …do a matching cart write in the Project; Ctrl-C to deregister and exit.
commercetools integration-layer extension serve-api-extension --cleanup   # sweep leftovers from a crash
```

No `ngrok`? Any tunnel works, including zero-install SSH ones — e.g.
`ssh -R 80:localhost:4000 localhost.run` prints an `https://…lhr.life` URL to pass as
`--public-url`, and `cloudflared tunnel --url http://localhost:4000` does the same.

`ctx.config` comes from `EXTENSION_CONFIG_*` / `.env` / `--env-file`, with `--config`
overriding a key (same as `invoke-api-extension`).

**Monorepo (`--all`).** Like `serve`/`build`/`push`, `--all` builds + watches every
package under `./extensions/*` and serves the **one combined bundle** a Project deploys —
every package's `apiExtensions` concatenated — registering the whole set (and re-merging
on any package's edit). Without it, it serves the single `--entry` bundle in the cwd. A
given API-Extension `key` must be unique across packages (a Project ships one bundle).

**Safety — it never disturbs a real Extension.** Before registering, it inspects the
Project's existing Extensions and **refuses** only if one already triggers on the *same
resource + action* it would register (a collision commercetools rejects anyway);
unrelated Extensions are left untouched. It owns everything it creates under the
`il-localdev-` key prefix and **deletes** those on exit. Prefer a dedicated dev/sandbox
Project. Needs a `manage_project` login (it calls the commercetools API directly).

This is a **separate command from `serve` on purpose** (not a `serve --api-extensions`
flag): `serve` is a safe, login-free local server, whereas this one logs in and registers
a callback in commercetools. Keeping them apart makes that registration an explicit,
deliberate act — running `serve` can never register anything in commercetools by accident.

| Flag | Default | Notes |
| --- | --- | --- |
| `--public-url` | — | **required** (unless `--cleanup`); the tunnel's base URL. commercetools calls `<public-url>/api-extensions` |
| `-p`, `--port` | `4000` | local port to listen on |
| `--config` | — | repeatable `KEY=VALUE`, becomes `ctx.config` (overrides env / `.env`) |
| `--all` | `false` | serve + register the combined bundle from every `./extensions/*` package (the deployed shape) |
| `--extensions-dir` | `extensions` | directory holding the extension packages (used with `--all`) |
| `--cleanup` | `false` | remove leftover `il-localdev-*` Extensions and exit (does not serve) |
| `--env-file` | — | optional dotenv path (default: load `.env` from cwd if present) |

Errors out if the bundle declares no `apiExtensions`, if an existing Extension collides
with a resource/action it would register, or (with `--all`) if two packages declare the
same API-Extension `key`.

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

### `project-settings`

```
commercetools integration-layer project-settings get [--json]
commercetools integration-layer project-settings set [--label <TEXT>] [--language <CODE>] [--currency <CODE>] [--country <CODE>]
```

The project settings an operator edits on the Merchant Center **Project Settings** tab:
the display label and the default language, currency and presentment country. The region
and public endpoints are owned by the Commerce Integration Layer and aren't settable.

`set` changes only the fields you pass and keeps the others at their current value, so
a pipeline can update one setting without knowing the rest. The Commerce Integration
Layer stores the defaults without checking them and later seeds new shopper sessions with
them, so `set` checks `--language`, `--currency` and `--country` against the languages,
currencies and countries the project presents (the same lists the Merchant Center's
dropdowns offer; the Commerce Integration Layer reports them with the settings, so the
client needs no commercetools scope beyond its own). The project's own spelling is stored,
so `--country de` saves `DE`; a value the project doesn't present is refused with the list
it does present.

```bash
commercetools integration-layer project-settings set --currency EUR --country DE
```

### `idp-login`

```
commercetools integration-layer idp-login get [--json]
commercetools integration-layer idp-login set [--issuer <URL>] [--token-endpoint <URL>] [--revocation-endpoint <URL>]
                                              [--jwks-uri <URL>] [--authorization-endpoint <URL>]
                                              [--client-id <ID>] [--client-secret <SECRET>] [--redirect-uri <URL>]
                                              [--claim-external-id|-email|-first-name|-last-name|-phone <CLAIM>]
                                              [--match-strategy externalId|email]
commercetools integration-layer idp-login delete [--force]
```

The external OpenID Connect identity provider shoppers can sign in with — the Merchant
Center **IdP Login** tab. The client secret is write-only: `get` only reports whether
one is set.

The first `set` needs the issuer, token, revocation and JWKS endpoints, client ID,
redirect URI and client secret; the claim mapping defaults to `sub`, `email`,
`given_name`, `family_name` and `phone_number`, matching by external ID. After that,
`set` changes only the flags you pass, and leaving the secret out keeps the stored one.
Pass the secret as the `IDP_CLIENT_SECRET` environment variable rather than a flag, so
it stays out of the process list and shell history. The token, revocation and JWKS endpoints
must be absolute `http(s)` URLs without embedded credentials — the Commerce Integration
Layer refuses anything else, and `set` tells you before sending. `--authorization-endpoint ''`
clears the optional authorization endpoint.

`delete` disables IdP login for the project, so it prompts for confirmation; `--force`
skips it, and without a TTY it refuses unless `--force` is given.

### `checkout-rules`

```
commercetools integration-layer checkout-rules get [--json]
commercetools integration-layer checkout-rules add --application-key <KEY> [--mode PAYMENT_ONLY|COMPLETE]
                                                   [--country <CC,...>] [--store <KEY,...>] [--position <N>]
commercetools integration-layer checkout-rules remove <POSITION> [--force]
commercetools integration-layer checkout-rules set --file <PATH|-> [--force]
```

Which commercetools Checkout Application the Commerce Integration Layer names when it
mints a Checkout Session — the Merchant Center **Checkout** tab. The rules are an
**ordered** list: the first rule matching the shopper's country **and** store wins. A
rule lists countries (ISO 3166-1 alpha-2) and/or store keys, each OR-matched; leave one
out to match any, and a rule with neither matches every shopper — a catch-all, so put it
last. `add` appends by default; `--position` places it elsewhere in the order.

| Command | Effect |
| --- | --- |
| `get` | print the rules in match order (positions are what `remove` takes) |
| `add` | read-modify-write: inserts one rule |
| `remove` | read-modify-write: drops the rule at a position; confirms unless `--force` |
| `set` | **replaces the whole list** from a JSON file (`-` for stdin); confirms unless `--force` |

`set` is the form for a pipeline — keep the rules in version control:

```json
[
  { "countries": ["DE", "AT"], "applicationKey": "eu-checkout", "mode": "COMPLETE" },
  { "stores": ["vip-store"], "applicationKey": "vip-checkout", "mode": "PAYMENT_ONLY" },
  { "applicationKey": "default-checkout", "mode": "PAYMENT_ONLY" }
]
```

```bash
commercetools integration-layer checkout-rules set --file checkout-rules.json --force
```

At least one rule must remain, so `remove` refuses to drop the last one. Without a TTY
the confirming commands refuse unless `--force` is given. Checkout rules have their own
route, so `project-settings set` never overwrites them.

### `field-visibility`

```
commercetools integration-layer field-visibility list [--hidden] [--json]
commercetools integration-layer field-visibility hide --type-key <KEY> [--space customField|attribute] <FIELD...>
commercetools integration-layer field-visibility show --type-key <KEY> [--space customField|attribute] <FIELD...> [--force]
commercetools integration-layer field-visibility set  --file <PATH|-> [--force]
```

Which of your own commercetools custom fields and product attributes a storefront can
select — the picker on the Merchant Center **Schema** tab. A hidden field is still
resolvable internally, so your extension can read it with `@requires`; it is just absent
from the public API schema, so a shopper can neither query nor discover it.

Fields are named by **your own identifiers** — the custom Type's (or Product Type's) key
and the field's name — never a generated GraphQL name, which changes with the rest of the
project. `--space` is `customField` (the default) for a custom Type's field and
`attribute` for a product attribute.

| Command | Effect |
| --- | --- |
| `list` | every field, grouped by type, marked `hidden` or `visible`; a rule that does nothing says why |
| `hide` | read-modify-write: adds the fields of one type to the hidden set |
| `show` | read-modify-write: removes their rules; confirms unless `--force` |
| `set` | **replaces the whole hidden set** from a JSON file (`-` for stdin); confirms unless `--force` |

`show` and `set` make fields publicly selectable, so they prompt; without a TTY they
refuse unless `--force` is given. For a pipeline, keep the set in version control:

```json
[
  { "space": "customField", "typeKey": "internal-ops", "fieldName": "costPrice" },
  { "space": "attribute", "typeKey": "shoes", "fieldName": "internalCode" }
]
```

**A rule can be written before its field exists** — `hide` notes this and stores it. That
is the safe order: there is no moment the new field is public. `list` shows such a rule as
not in force until the field appears.

Every save republishes the schema, and the command waits for the outcome: it prints
`The schema was republished.` on success. If the rules were stored but the republish failed,
the published schema doesn't reflect them yet — a hidden field is still public — so the
command exits with code **2** and says so. Re-run it, or use “Refresh schema” on the
Merchant Center Schema tab.

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

[extsvc]: https://docs.commercetools.com/commerce-integration-layer/schema-extensions

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
