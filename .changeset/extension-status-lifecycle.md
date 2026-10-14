---
'@commercetools/cli-topic-integration-layer': minor
---

`integration-layer extension status` now prints the newest stored bundle's lifecycle `state`, the failure `reason` when it failed to load, and the revision actually being served. The served line says whether it is the newest stored version, an older one because the newest failed to load, or nothing. A deployment that does not report state prints `unknown` rather than a failure.
