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
  const { typeDefs, resolverTypes } = await validateBundle(outfile, sourceFiles);
  process.stdout.write(
    `✓ bundle is a valid, composable extension subgraph (resolver roots: ${
      resolverTypes.join(", ") || "none"
    })\n`,
  );

  const result = await remoteValidate(typeDefs);
  printValidationResult(result);
  if (!result.valid) {
    process.exit(1);
  }
}
