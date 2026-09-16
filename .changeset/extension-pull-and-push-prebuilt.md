---
"@commercetools/cli-topic-integration-layer": minor
---

`integration-layer extension`: add `pull` to download the stored bundle, and let `push` upload a pre-built `.cjs` directly.

`extension pull` downloads the project's served bundle (`GET /extension/bundle`) to a file — defaulting to the stored filename under `./dist`, overridable with `--out` — and reports the version and source revision it fetched. It refuses to overwrite an existing file unless `--force` is given. Previously only the bundle's metadata was reachable (via `extension status`), never the code.

`extension push` now takes an optional path argument, auto-detected by extension: `push ./dist/extension.cjs` uploads that pre-built bundle as-is (skipping the esbuild step), while `push ./src/extension.ts` (or any non-`.cjs` path) builds from source as before. A pre-built bundle is still validated — its shape/SDL coherence locally and composition/breaking-changes remotely — before it is stored; `--force` still overrides the remote check. Passing a path together with `--all` is rejected.
