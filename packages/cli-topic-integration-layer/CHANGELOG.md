# @commercetools/cli-topic-integration-layer

## 0.3.0

### Minor Changes

- b261d5c: `integration-layer init` now defaults to the current directory when the target is empty, so you can scaffold an extension in place without passing a path.

### Patch Changes

- b261d5c: Fix `integration-layer extension serve --gateway`/`--all` so it reaches `/session` and the core GraphQL on the identity edge.
