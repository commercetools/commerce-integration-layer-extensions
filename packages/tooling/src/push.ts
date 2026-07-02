// `ee-ext push` — upload the current example's built bundle into the integration
// layer's per-project object store, via `PUT /api/<project>/extensions` (guarded by
// the commercetools `manage_project` trust boundary, so we mint a token for it). The
// store holds one bundle per project, so a second push REPLACES the first.
//
// Before uploading we validate twice: LOCALLY (validateBundle — static analysis +
// shape/coherence) and REMOTELY (remoteValidate — composes with the integration
// layer, no breaking changes). A failing REMOTE result aborts unless forced
// (EE_FORCE=1 / --force); the LOCAL check always hard-fails.

import { readFile } from 'node:fs/promises';
import { buildBundle } from './build.js';
import { validateBundle } from './validateBundle.js';
import { mintManageProjectToken, required } from './ctToken.js';
import { remoteValidate, printValidationResult } from './remoteValidate.js';

/** Force-push despite a failing remote validation: `EE_FORCE` env or a `--force`/`-f` flag. */
function forceRequested(): boolean {
  const env = process.env.EE_FORCE;
  if (env && env !== '0' && env.toLowerCase() !== 'false') return true;
  return process.argv.slice(2).some((arg) => arg === '--force' || arg === '-f');
}

/** Build + validate (local + remote) + upload the current example. Exits 1 on failure. */
export async function pushCommand(): Promise<void> {
  const integrationLayerUrl = required('INTEGRATION_LAYER_URL').replace(/\/+$/, '');
  const projectKey = required('CTP_PROJECT_KEY');
  const authUrl = required('CTP_AUTH_URL');
  const clientId = required('CTP_CLIENT_ID');
  const clientSecret = required('CTP_CLIENT_SECRET');

  // Bundle, then VALIDATE before we touch the store. Local check first — it always
  // hard-fails, regardless of --force.
  const { outfile, sourceFiles } = await buildBundle();
  const { typeDefs, resolverTypes, apiExtensionKeys } = await validateBundle(outfile, sourceFiles);
  process.stdout.write(
    `✓ validated bundle (resolver roots: ${resolverTypes.join(', ') || 'none'}; ` +
      `API extensions: ${apiExtensionKeys.join(', ') || 'none'})\n`,
  );

  // Remote check composes the GraphQL subgraph WITH the integration layer + checks
  // for breaking changes. Only applies when the bundle has a subgraph — an
  // API-extensions-only bundle has no SDL, so skip straight to the upload (the
  // connector reports its declared API extensions to the integration layer on load,
  // which registers them with commercetools).
  if (typeDefs !== null) {
    const remote = await remoteValidate(typeDefs);
    printValidationResult(remote);
    if (!remote.valid) {
      if (!forceRequested()) {
        process.stderr.write('Aborting push. Re-run with EE_FORCE=1 (or --force) to override.\n');
        process.exit(1);
      }
      process.stderr.write('⚠ forcing push despite failing validation (EE_FORCE/--force).\n');
    }
  }

  const bundle = await readFile(outfile, 'utf8');
  const token = await mintManageProjectToken(authUrl, clientId, clientSecret, projectKey);

  const url = `${integrationLayerUrl}/api/${encodeURIComponent(projectKey)}/extensions`;
  process.stdout.write(`Pushing extension bundle (${bundle.length} bytes) → ${url}\n`);

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/javascript',
      // The route requires the original filename (percent-encoded; it carries the
      // module's type). The bundle is plain CommonJS, so name it `.cjs`.
      'x-extension-filename': encodeURIComponent('example-extension.cjs'),
    },
    body: bundle,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PUT extensions failed (${res.status}): ${text}`);
  }
  process.stdout.write(`✓ stored: ${text}\n`);
}
