---
"@commercetools/cli-topic-integration-layer": minor
---

`init` now scaffolds a colocated Vitest test for the starter extension (`extensions/hello-world/src/extension.test.ts`) that calls the resolver directly against a minimal fake context. The generated `hello-world` package gains a `test` script (`vitest run`) plus `vitest` as a dev dependency, and the root gains a `pnpm test` script that fans the suites out across every extension (`pnpm -r test`). The README and CLI docs document the pattern so a copied extension stays testable out of the box.
