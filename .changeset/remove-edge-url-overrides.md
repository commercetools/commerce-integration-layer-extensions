---
"@commercetools/cli-topic-integration-layer": major
---

Remove the `explore` / `extension serve` edge-URL override flags and their environment variables.

`--graphql-url` / `IL_GRAPHQL_URL` and `--auth-url` / `IL_AUTH_URL` are gone. The Experience (router) and Identity edges are always derived from the logged-in project Region, so the overrides were unnecessary; the command now fails loudly if the Region is missing rather than accepting a URL. The Extensions edge keeps its `--integration-layer-url` / `INTEGRATION_LAYER_URL` override (a Connect configuration key).
