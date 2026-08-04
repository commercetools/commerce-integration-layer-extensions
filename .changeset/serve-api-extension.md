---
"@commercetools/cli-topic-integration-layer": minor
---

Add `extension serve-api-extension` for local end-to-end debugging of commercetools API Extensions. It serves the bundle's `apiExtensions` handlers over HTTP (in plain Node, so breakpoints work) and dynamically registers a commercetools API Extension pointing at a tunnel you supply with `--public-url`, so a real cart/order write in the Project calls the code on your machine. Editing the source hot-reloads the handlers and re-registers on a changed trigger.

The command is deliberately conservative: it **refuses** to run if the Project already has any API Extension (so it can never disturb a real one), owns everything it creates under the `il-localdev-` key prefix, and deletes those on exit; `--cleanup` sweeps leftovers from a crashed run. Point it at a dedicated dev/sandbox Project.
