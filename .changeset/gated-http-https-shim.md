---
"@commercetools/cli-topic-integration-layer": minor
---

Allow extensions to `import` the Node `http`/`https` modules. They resolve to a gated shim (`request`/`get` over the same allowlist-gated `fetch`), never Node's real modules — so a plain-`https` SDK now builds, validates, and runs, with no raw socket and the same per-Project allowlist/SSRF guarantees as `fetch`.

`build.ts` leaves `http`/`https`/`node:http`/`node:https` external instead of failing the bundle with "Could not resolve"; `staticAnalysis.ts` allows those four ids while still rejecting every other Node built-in; and the local `serve`/`loadBundle` path resolves them to the shim so local dev matches the deployed sandbox. An `http`/`https` `Agent` is accepted but inert (pooling/TLS options ignored, one-time warning).
