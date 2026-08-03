---

"@commercetools/cli-topic-integration-layer": minor

---



Generalise `extension invoke-api-extension` beyond cart callbacks: `--input` (required) supplies a full commercetools `ExtensionInput`; `--key` (repeatable) restricts invocation to named handlers; `--all`/`--extensions-dir` invoke the merged bundle. Add `extension create-api-extension-input`, which derives supported resource types and enum values from `@commercetools/platform-sdk` and scaffolds realistic `{ action, resource }` JSON for local handler testing.



