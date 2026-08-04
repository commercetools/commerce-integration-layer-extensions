---
"@commercetools/cli-topic-integration-layer": minor
---

Add `extension serve-api-extension` for local end-to-end debugging of commercetools API Extensions. It serves the bundle's `apiExtensions` handlers over HTTP (in plain Node, so breakpoints work) and dynamically registers a commercetools API Extension pointing at a tunnel you supply with `--public-url`, so a real cart/order write in the Project calls the code on your machine. Editing the source hot-reloads the handlers and re-registers on a changed trigger.

The command is deliberately conservative: before registering it **refuses** if an existing Extension already triggers on the same resource + action it would register (a collision, which commercetools rejects anyway) — unrelated Extensions are left untouched. It owns everything it creates under the `il-localdev-` key prefix and deletes those on exit; `--cleanup` sweeps leftovers from a crashed run. Point it at a dedicated dev/sandbox Project.

Like `serve`/`build`/`push`, it supports `--all`: in a monorepo of `extensions/*` packages it builds, watches, and serves the one combined bundle a Project deploys (every package's `apiExtensions` concatenated) and registers the whole set, re-merging on any package's edit. Each API-Extension `key` must be unique across packages.
