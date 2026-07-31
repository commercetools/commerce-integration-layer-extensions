---
"@commercetools/cli-topic-integration-layer": minor
---

Add `integration-layer allowlist` commands to view and manage the extension HTTP allowlist — the hosts the extension sandbox's `fetch` may reach. `list` shows the merchant `allow` patterns plus the operator `deny` ceiling; `add`/`remove` amend the allow list, and `set` replaces it wholesale (requiring at least one host). Backed by the integration layer's `GET`/`PUT /<project>/extension/allowlist` routes under the `manage_project` login.
