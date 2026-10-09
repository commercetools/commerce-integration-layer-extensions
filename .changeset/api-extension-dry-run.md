---
"@commercetools/cli-topic-integration-layer": minor
---

`extension validate` and `extension push` now ask the Commerce Integration Layer whether the bundle's API Extension declarations would register. `push` aborts before uploading when they would be refused (`--force` overrides, as for the subgraph check), so it needs a Commerce Integration Layer that serves the dry-run route. `ApiExtensionAction` and the validator no longer restrict actions to `Create` and `Update` — the project decides what it accepts.
