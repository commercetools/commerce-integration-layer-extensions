---
"@commercetools/cli-topic-integration-layer": minor
---

Send the `main` instance segment in every Commerce Integration Layer URL. Requests to the Extensions edge, the Experience API and the Identity API now go to `/<project>/main/…` instead of `/<project>/…`. The bare form still resolves to `main`, so no configuration changes are needed.
