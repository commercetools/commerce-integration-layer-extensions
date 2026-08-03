---
"@commercetools/cli-topic-integration-layer": minor
---

Add `extension invoke-api-extension --deployed`: fire the API-Extension callback at the project's DEPLOYED extension (the LIVE code commercetools calls on a write) through the Commerce Integration Layer, instead of running the local bundle in-process. Only the integration layer can sign the connector's `/api-extensions` callback (the shared secret is derived from the project's stored client secret and never leaves the server), so `--deployed` posts the payload to a new IL signing-proxy route and prints the connector's verdict; **nothing is persisted** to commercetools. It requires a `commercetools auth login`, uses the deployed code + the project's stored config, and returns the connector's single merged verdict — so it can't be combined with the local-bundle flags (`--all`, `--extensions-dir`, `--entry`, `--out`, `--config`, `--key`). Local (default) invocation is unchanged.

Requires the companion Commerce Integration Layer route (`POST /:projectKey/extension/api-extensions/invoke`).
