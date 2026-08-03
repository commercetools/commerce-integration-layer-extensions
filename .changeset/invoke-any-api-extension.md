---
"@commercetools/cli-topic-integration-layer": minor
---

Generalise `extension invoke-api-extension` beyond cart callbacks: `--input` (required) supplies a full commercetools `ExtensionInput`; `--key` (repeatable) restricts invocation to named handlers; `--all`/`--extensions-dir` invoke the merged bundle. Add `extension sample-generate` to scaffold realistic `{ action, resource }` JSON for any supported API-Extension resource type.

