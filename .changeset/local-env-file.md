---
"@commercetools/cli-topic-integration-layer": minor
---

Load a project `.env` (or `--env-file <path>`) before commands run, so `INTEGRATION_LAYER_URL` and local `EXTENSION_CONFIG_*` values work without exporting them in the shell (a variable already set in the environment still wins). `extension serve` additionally **hot-reloads** that file — editing an `EXTENSION_CONFIG_*` value updates `ctx.config` for the next request with no restart — and `extension invoke-api-extension` reads the same `EXTENSION_CONFIG_*` (env / `.env` / `--env-file`) for its `ctx.config`, with `--config` overriding a given key.
