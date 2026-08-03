---
"@commercetools/cli-topic-integration-layer": minor
---

Make `extension invoke-api-extension` able to call any API-Extension handler, not just a cart callback. New flags: `--resource-type` (default `cart`) targets the built-in sample at any resource (order, payment, …); `--input <file.json>` supplies a full commercetools `ExtensionInput` (or a bare resource) so a handler runs against a realistic payload; `--key` (repeatable) restricts invocation to named handlers. A handler still fires only when its `resourceTypeId`/`actions` match the payload. It also gains `--all`/`--extensions-dir`, invoking the single merged bundle a project deploys (the `apiExtensions` from every `./extensions/*` concatenated), consistent with `build`/`validate`/`push`/`serve`. The existing cart defaults (`--sku`/`--quantity`) are unchanged.
