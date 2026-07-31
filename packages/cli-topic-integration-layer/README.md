# @commercetools/cli-topic-integration-layer

A [commercetools CLI](https://github.com/commercetools/cli) plugin that adds the
`integration-layer` topic. It is published to the public npm registry and installed on
demand as a runtime oclif plugin — it is never bundled into the base `@commercetools/cli`.

## Install

```bash
# Public CLI. NB: use @dev for now — the `plugins` command (@oclif/plugin-plugins)
# is only in the CLI's dev prerelease; @latest (0.0.17) predates it. Drop to
# @latest once plugin-plugins is promoted to the latest release.
npm install -g @commercetools/cli@dev

# Opt in to the integration-layer topic (public npm — no auth needed)
commercetools plugins install @commercetools/cli-topic-integration-layer
```

## Commands

```bash
commercetools integration-layer init <DIR>               # scaffold an extension project [local]

commercetools integration-layer extension build          # bundle src/extension.ts -> dist [local]
commercetools integration-layer extension validate        # local checks + remote compose/breaking gate
commercetools integration-layer extension push [--force]   # build + validate + upload the bundle
                       [--source-revision <rev> | --no-source-revision]   # provenance; default: detected from git
commercetools integration-layer extension status          # show the project's stored bundle
commercetools integration-layer extension delete [--yes]   # remove the extension subgraph

commercetools integration-layer schema fetch [--out f]    # print the project's core-subgraph SDL

commercetools integration-layer config list               # config entries (secrets masked)
commercetools integration-layer config get <KEY>
commercetools integration-layer config set <KEY> <VALUE> [--secret]
commercetools integration-layer config unset <KEY>

commercetools integration-layer allowlist list            # hosts the extension's fetch may reach (+ operator deny)
commercetools integration-layer allowlist add <HOST...>    # allow one or more hosts (api.foo.com or *.foo.com)
commercetools integration-layer allowlist remove <HOST...>  # stop allowing one or more hosts (--force to skip confirmation)
commercetools integration-layer allowlist set <HOST...>    # replace the whole allowlist (--force to skip confirmation)

commercetools integration-layer --version             # print the installed plugin version [local]
```

Authenticated commands present the token from `commercetools auth login` (a
`manage_project` bearer) and resolve the integration-layer edge from
`--integration-layer-url` / `INTEGRATION_LAYER_URL` (a region-implied URL is a TODO).
`build` / `init` are local and need no login. See
[`integration-layer-cli-command-structure.md`](../../integration-layer-cli-command-structure.md)
for the full command → route mapping.

## Develop

This package lives in the octolog monorepo as the `integration-layer-cli` domain
(pnpm workspace, member `app/`). From the repo root:

```bash
pnpm ilc:install     # install
pnpm ilc:build       # tsc -> dist/
pnpm ilc:typecheck   # tsc --noEmit (src + tests)
pnpm ilc:lint        # eslint
pnpm ilc:test        # vitest

# Run the built command directly against the public CLI's runner:
#   commercetools plugins link .   (from app/, after build)
```

## License

MIT — see [LICENSE](LICENSE).
