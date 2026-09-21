---
"@commercetools/cli-topic-integration-layer": minor
---

Rename the Experience API and Identity API override flags and environment variables. Backwards compatible — the old names still work.

- `--graphql-url` / `IL_GRAPHQL_URL` → **`--experience-url` / `CIL_EXPERIENCE_URL`** (the shopper GraphQL edge, the Experience API), on `integration-layer explore`.
- `--auth-url` / `IL_AUTH_URL` → **`--identity-url` / `CIL_IDENTITY_URL`** (the session/identity edge, the Identity API), on `integration-layer explore` and `integration-layer extension serve`.

The old flags stay as **hidden, deprecated aliases** and the old environment variables (`IL_GRAPHQL_URL`, `IL_AUTH_URL`) are still read as fallbacks. Both keep working for one deprecation window and both emit a notice when used, telling you to switch to the new name; they will be removed in a later major. When both an old and a new name are set, the **new name wins**.

`--integration-layer-url` / `INTEGRATION_LAYER_URL` (the Extensions edge, also a Connect configuration key) is **unchanged**.
