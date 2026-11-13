---
'@commercetools/cli-topic-integration-layer': patch
---

`extension serve --gateway` and `--all` reach the Commerce Integration Layer's core subgraph through the Extensions edge (`/<project>/main/subgraph/graphql`), authenticated with your login. `--integration-layer-url` now redirects these calls too. Session minting stays on the Identity API host.
