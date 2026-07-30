---
"@commercetools/cli-topic-integration-layer": patch
---

Fix "not logged in" when the topic is installed via `oclif plugins install`. The
topic now reads the logged-in principal from `~/.commercetools/credentials` via its
own `FileBasedAuthenticationRepository` instead of the auth plugin's in-memory
security context, so it no longer matters that an out-of-tree plugin install loads a
second, empty copy of `@commercetools/cli-plugin-auth`. That package moves from a peer
to a regular dependency accordingly.
