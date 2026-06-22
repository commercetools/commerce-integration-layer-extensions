// Validate a candidate extension SDL against the integration layer — the
// cross-subgraph half of the push-time gate (validateBundle.ts is the local half). It
// asks the integration layer to (1) compose the extension with the project's
// integration-layer subgraph (catching collisions a standalone compose can't) and
// (2) reject breaking changes versus the project's published schema. Authenticates
// like push.ts (a `manage_project` CT token). Used by `ee-ext validate` and `push`.

import { mintManageProjectToken, required } from './ctToken.js';

export interface BreakingChange {
  type: string;
  description: string;
}

export interface RemoteValidationResult {
  valid: boolean;
  composes: boolean;
  compositionErrors: string[];
  breakingChanges: BreakingChange[];
  /** False when no published baseline was available, so the breaking check was skipped. */
  comparedToPublished: boolean;
}

/** POST the candidate SDL to the integration layer's validation endpoint. */
export async function remoteValidate(typeDefs: string): Promise<RemoteValidationResult> {
  const integrationLayerUrl = required('INTEGRATION_LAYER_URL').replace(/\/+$/, '');
  const projectKey = required('CTP_PROJECT_KEY');
  const authUrl = required('CTP_AUTH_URL');
  const clientId = required('CTP_CLIENT_ID');
  const clientSecret = required('CTP_CLIENT_SECRET');

  const token = await mintManageProjectToken(authUrl, clientId, clientSecret, projectKey);
  const url = `${integrationLayerUrl}/api/${encodeURIComponent(projectKey)}/extensions/validate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ typeDefs }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`schema validation request failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as RemoteValidationResult;
}

/** Print a validation result legibly. Returns nothing — callers decide on exit. */
export function printValidationResult(result: RemoteValidationResult): void {
  if (!result.composes) {
    process.stderr.write('✗ extension does not compose with the integration layer supergraph:\n');
    for (const err of result.compositionErrors) {
      process.stderr.write(`  - ${err}\n`);
    }
    return;
  }
  if (result.breakingChanges.length > 0) {
    process.stderr.write('✗ extension introduces breaking changes to the published supergraph:\n');
    for (const change of result.breakingChanges) {
      process.stderr.write(`  - [${change.type}] ${change.description}\n`);
    }
    return;
  }
  if (!result.comparedToPublished) {
    process.stdout.write(
      '✓ composes with the integration layer supergraph (breaking-change check skipped: no published baseline)\n',
    );
    return;
  }
  process.stdout.write(
    '✓ composes with the integration layer supergraph and introduces no breaking changes\n',
  );
}
