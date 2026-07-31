---
"@commercetools/cli-topic-integration-layer": minor
---

Add `integration-layer allowlist` commands to view and manage the extension HTTP allowlist — the hosts the extension sandbox's `fetch` may reach. `list` shows the merchant `allow` patterns plus the operator `deny` ceiling; `add`/`remove` amend the allow list, and `set` replaces it wholesale (requiring at least one host). `set` and `remove` show the current and proposed allow lists and ask for confirmation (`--force` skips). Backed by the integration layer's `GET`/`PUT /<project>/extension/allowlist` routes under the `manage_project` login.

`extension serve` now gates resolver `fetch` with the same allowlist when logged in and online; without login or when the integration layer is unreachable, fetch is unrestricted locally (stderr warning).
