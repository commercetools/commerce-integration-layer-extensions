---
"@commercetools/cli-topic-integration-layer": patch
---

`extension validate` and `extension push` no longer reject a bundle whose only
contribution is a capability the runtime dispatches directly rather than through the
schema. Such a bundle adds nothing to the SDL, so it was failing the "must export
`typeDefs` and/or `apiExtensions`" shape check even though it is complete and
deployable. A bundle that contributes nothing at all is still rejected.
