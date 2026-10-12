---
'@commercetools/cli-topic-integration-layer': patch
---

Ship an `npm-shrinkwrap.json` with the published plugin so `commercetools plugins install` installs a pinned dependency tree. Previously npm resolved every transitive range at install time, so a partly published upstream release (for example `@graphql-tools/*` on 2026-10-12, where dependents were live before their dependencies) failed the install with `ETARGET`, even for an already-published plugin version. The shrinkwrap is generated at publish time from releases at least 24 hours old.
