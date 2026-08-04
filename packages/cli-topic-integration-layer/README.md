# @commercetools/cli-topic-integration-layer

A [commercetools CLI](https://github.com/commercetools/cli) plugin that adds the
`integration-layer` topic — the tooling for authoring, running, validating, publishing,
and inspecting [Commerce Integration Layer][docs] extensions.

It is published to the public npm registry and installed on demand as a runtime oclif
plugin; it is never bundled into the base `@commercetools/cli`.

[docs]: https://docs.commercetools.com/integration-layer

## Install

```bash
# NB: use @dev for now — the `plugins` command (@oclif/plugin-plugins) ships only in
# the CLI's dev prerelease. Drop @dev once it is promoted to the latest release.
npm install -g @commercetools/cli@dev

# Opt in to the integration-layer topic (public npm — no auth needed)
commercetools plugins install @commercetools/cli-topic-integration-layer

# Log in once — mints the manage_project token the authenticated commands reuse
commercetools auth login --project-key <your-project-key>
```

## Commands

```bash
commercetools integration-layer init [DIR]                  # scaffold an extensions monorepo [offline]

commercetools integration-layer extension build             # bundle src/extension.ts → dist [offline]
commercetools integration-layer extension serve             # local dev server; allowlist-gated fetch when online + logged in
commercetools integration-layer extension invoke-api-extension   # fire an API-Extension callback at the local bundle [offline], or --deployed via the IL

commercetools integration-layer explore                     # local GraphQL explorer over your deployed edge
commercetools integration-layer schema fetch                # the Project's core-subgraph SDL

commercetools integration-layer config list|get|set|unset   # per-project extension configuration

commercetools integration-layer allowlist list|add|remove|set   # hosts the extension's fetch may reach

commercetools integration-layer --version                   # the installed plugin version [offline]
```

Add `--all` to `build` / `serve` / `validate` / `push` to merge every extension under
`./extensions/*` into the single bundle a Project deploys.

Authenticated commands present the token from `commercetools auth login` (a
`manage_project` bearer) and derive the Commerce Integration Layer's hosts from your login
Region; `--integration-layer-url` / `INTEGRATION_LAYER_URL` overrides the extensions
edge.

**[Full reference — every command, flag, host, and CI usage][ref]** and
[extension-authoring detail][authoring] live in the
[commerce-integration-layer-extensions][repo] repository, which also holds ready-to-edit
templates for each pattern.

[repo]: https://github.com/commercetools/commerce-integration-layer-extensions
[ref]: https://github.com/commercetools/commerce-integration-layer-extensions/blob/main/docs/cli.md
[authoring]: https://github.com/commercetools/commerce-integration-layer-extensions/blob/main/docs/authoring.md

## Develop

This package lives in the [commerce-integration-layer-extensions][repo] repo. From the repo
root:

```bash
pnpm install
pnpm --filter @commercetools/cli-topic-integration-layer build       # tsc → dist/
pnpm --filter @commercetools/cli-topic-integration-layer test        # vitest
pnpm typecheck
pnpm lint

pnpm setup:cli    # build + `commercetools plugins link` this checkout
```

Changing the plugin? Add a changeset (`pnpm changeset`) in your PR — see
[Developing the plugin][dev] for the release flow.

[dev]: https://github.com/commercetools/commerce-integration-layer-extensions/blob/main/docs/cli.md#developing-the-plugin
