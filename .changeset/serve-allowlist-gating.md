---
"@commercetools/cli-topic-integration-layer": minor
---

`extension serve` gates resolver `fetch` with the project's HTTP allowlist when logged in and the Commerce Integration Layer is reachable. Without login or when offline, fetch is unrestricted locally (stderr warning).
