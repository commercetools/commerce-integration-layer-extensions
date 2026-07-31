# @commercetools/cli-topic-integration-layer

## 0.5.0

### Minor Changes

- 21d3372: Add `integration-layer allowlist` commands to view and manage the extension HTTP allowlist — the hosts the extension sandbox's `fetch` may reach. `list` shows the merchant `allow` patterns plus the operator `deny` ceiling; `add`/`remove` amend the allow list, and `set` replaces it wholesale (requiring at least one host). `set` and `remove` show the current and proposed allow lists and ask for confirmation (`--force` skips). Backed by the integration layer's `GET`/`PUT /<project>/extension/allowlist` routes under the `manage_project` login.
- 409f182: Remove the placeholder `integration-layer hello` command; it only printed a hello-world message and served no real purpose.

### Patch Changes

- 60b6110: Documentation only. The package README is now a self-contained npm card that lists every command (including `serve`, `invoke`, `explore`, `--all` and `--version`) and links to the new CLI reference and authoring guide, replacing a stale link to a file that doesn't exist and instructions for `pnpm ilc:*` scripts from another repo. The README `integration-layer init` scaffolds is trimmed to project-specific setup and points at the Integration Layer documentation instead of restating it.

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
