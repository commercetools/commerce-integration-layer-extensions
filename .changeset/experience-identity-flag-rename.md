---
"@commercetools/cli-topic-integration-layer": major
---

Rename the Experience API and Identity API override flags and environment variables.

- `--graphql-url` / `IL_GRAPHQL_URL` → **`--experience-url` / `CIL_EXPERIENCE_URL`** (the shopper GraphQL edge, the Experience API), on `integration-layer explore`.
- `--auth-url` / `IL_AUTH_URL` → **`--identity-url` / `CIL_IDENTITY_URL`** (the session/identity edge, the Identity API), on `integration-layer explore` and `integration-layer extension serve`.

The old flag names keep working as **hidden, deprecated aliases** (they emit a deprecation warning when used), and the old environment variables (`IL_GRAPHQL_URL`, `IL_AUTH_URL`) are still read as fallbacks — both for one deprecation window, to be removed in a later major. When both an old and a new name are set, the **new name wins**.

`--integration-layer-url` / `INTEGRATION_LAYER_URL` (the Extensions edge, also a Connect configuration key) is **unchanged**.
