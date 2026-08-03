---
"@commercetools/cli-topic-integration-layer": minor
---

Rename `extension invoke` to `extension invoke-api-extension`. The command only ever fired a sample cart callback at a bundle's `apiExtensions` handlers (never the GraphQL half), so the old name didn't say what it invoked. Behaviour and flags are unchanged; update any script or CI step that called `extension invoke`.
