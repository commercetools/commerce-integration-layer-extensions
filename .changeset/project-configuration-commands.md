---
"@commercetools/cli-topic-integration-layer": minor
---

Configure a project's Commerce Integration Layer from the CLI — everything an operator can set per project in the Merchant Center, without a browser. Four new commands, each with `get`/`list` to read the current state:

- `integration-layer project-settings get|set` — the project's label, default language, currency and country. `set` changes only the flags you pass, and checks language, currency and country against what the commercetools project presents, storing the project's own spelling.
- `integration-layer idp-login get|set|delete` — the external OpenID Connect identity provider shoppers sign in with. `set` changes only the flags you pass, takes the client secret from `IDP_CLIENT_SECRET`, and checks that the token, revocation and JWKS endpoints are absolute http(s) URLs.
- `integration-layer checkout-rules get|add|remove|set` — the ordered rules that pick the Checkout Application per country and store. `set` replaces the list from a JSON file (or stdin), so the rules can live in version control.
- `integration-layer field-visibility list|hide|show|set` — which custom fields and product attributes are hidden from the public API, named by your own type key and field name. Every save republishes the schema; if that fails the command exits with code 2.

Commands that replace or remove configuration ask for confirmation, and refuse to run without a terminal unless `--force` is given.
