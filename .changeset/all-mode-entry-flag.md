---
"@commercetools/cli-topic-integration-layer": minor
---

Make `--entry` consistent across `--all`. `build`, `validate`, and `push` now honour `--entry` in `--all` mode, applying it as the per-package source segment under each `./extensions/*` (the default still collapses to `src/extension.ts`, so `--entry src/main.ts` discovers and builds every package from its own `src/main.ts`). `extension serve` gains the same `--entry` flag, honoured in both standalone and `--all` mode. `--out` was already the single combined-artifact path under `--all` and is unchanged.
