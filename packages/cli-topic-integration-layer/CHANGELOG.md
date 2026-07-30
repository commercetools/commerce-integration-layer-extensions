# @commercetools/cli-topic-integration-layer

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
