---
'@commercetools/cli-topic-integration-layer': patch
---

`extension serve --gateway` and `--all` reach the Commerce Integration Layer's core subgraph through the Extensions edge (`/<project>/main/subgraph/graphql`), authenticated with your login, instead of the Identity API host. The core subgraph is no longer served on the Identity API host, so earlier versions' gateway mode stops working once that change rolls out; upgrade the plugin.
