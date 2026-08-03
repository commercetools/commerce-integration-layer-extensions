---
"@commercetools/cli-topic-integration-layer": patch
---

Refresh the `manage_project` bearer automatically instead of failing once it expires. Commands now authenticate like any other topic — a `prerun` hook fills this copy's security context from `~/.commercetools/credentials`, and every call goes through a `CtpAuthFetchFactory` fetch that injects the token and transparently refreshes/retries it. This removes the bespoke on-disk token reading and fixes `GET extension/bundle/meta failed (401): Bearer token is inactive or unknown` after a login goes stale.
