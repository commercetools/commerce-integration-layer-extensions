---
"@commercetools/cli-topic-integration-layer": patch
---

Fix `config list` / `get` / `set` / `unset` against the current Commerce Integration Layer. `GET`/`PATCH …/extension/config` now return `{ entries, maskExtensionGraphQLErrors }` (and PATCH takes that object, not a bare array); the client unwraps `entries` instead of treating the envelope as the list, which was `TypeError: entries is not iterable` / `.find is not a function`.
