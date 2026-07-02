// `ee-ext validate` — build + validate the current example's bundle WITHOUT pushing
// it. The same gate `push` runs, exposed on its own for local/CI use. Two layers:
//   1. LOCAL (validateBundle): static analysis + shape/coherence, offline.
//   2. REMOTE (remoteValidate): composes with the project's integration-layer subgraph
//      and rejects breaking changes. Talks to the integration layer, so it needs the
//      shared `.env` (INTEGRATION_LAYER_URL + CTP_* — see `.env.example`).

import { buildBundle } from "./build.js";
import { validateBundle } from "./validateBundle.js";
import { remoteValidate, printValidationResult } from "./remoteValidate.js";

/** Build + locally validate + remotely validate the current example. Exits 1 on failure. */
export async function validateCommand(): Promise<void> {
  const { outfile, sourceFiles } = await buildBundle();
  const { typeDefs, resolverTypes, apiExtensionKeys } = await validateBundle(outfile, sourceFiles);
  process.stdout.write(
    `✓ bundle is valid (resolver roots: ${resolverTypes.join(", ") || "none"}; ` +
      `API extensions: ${apiExtensionKeys.join(", ") || "none"})\n`,
  );

  // Remote composition applies only to the GraphQL subgraph. An API-extensions-only
  // bundle has no SDL to compose, so there's nothing remote to validate.
  if (typeDefs === null) {
    process.stdout.write("(no GraphQL subgraph — skipping remote composition check)\n");
    return;
  }

  const result = await remoteValidate(typeDefs);
  printValidationResult(result);
  if (!result.valid) {
    process.exit(1);
  }
}
