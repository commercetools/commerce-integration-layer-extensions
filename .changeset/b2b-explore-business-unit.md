---
"@commercetools/cli-topic-integration-layer": minor
---

`integration-layer explore`: add `--business-unit` / `--store` to scope a B2B session, and `--session-token` to supply an already-minted bearer.

A minted session has no business unit selected, so B2B operations failed. Passing `--business-unit <key> --store <key>` now performs the second storefront step (`PUT /session/business-unit`), which reissues the bearer the explorer proxies with. Both keys are required and the store must belong to the business unit. Selection needs a signed-in customer, so pair it with `--as` (or a `--session-token` that is already a customer session). `--session-token` (also `IL_SESSION_TOKEN`) lets you skip the login and hand the explorer an existing bearer directly.
