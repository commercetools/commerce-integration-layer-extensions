# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). It
tracks the versioning + changelog of the one publishable package in this repo,
`@commercetools/cli-topic-integration-layer`. The `examples/*` packages are `private`,
so Changesets ignores them automatically.

## Add a changeset with your PR

Any PR that changes the CLI plugin should include a changeset describing the change:

```bash
pnpm changeset
```

Pick the bump (`patch` / `minor` / `major`) and write a one-line summary — this becomes
the CHANGELOG entry. Commit the generated `.changeset/<name>.md` with your PR. A PR with
no user-facing plugin change needs no changeset (e.g. docs, an example-only edit).

## How a release happens

You do **not** run `changeset version` or publish by hand:

1. On merge to `main`, `.github/workflows/release.yml` collects pending changesets and
   opens/updates a **"Version Packages"** PR that bumps `package.json` and writes the
   CHANGELOG.
2. Merging that PR pushes a `v<version>` tag, which triggers
   `.github/workflows/publish-release.yml` to publish to the public npm registry via
   Trusted Publishing (OIDC).

See [`docs`/the repo README](../README.md#release) for the full flow.
