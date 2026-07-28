// Low-level HTTP client for the integration layer's per-project manage-surface
// routes. Every call is parameterised by (baseUrl, projectKey, token) — the command
// layer resolves those (`IntegrationLayerCommand.resolveIlContext`, whose token is the
// `commercetools auth login` principal's) and this module just speaks the wire
// protocol. The route bodies these mirror live in the integration
// layer's `routes/manage.ts`; the request/response shapes here are extracted from the
// `ee-ext` tooling's `remoteValidate.ts` / `push.ts` (which read them from env) and
// the remaining manage routes (config, status, delete, subgraph).

/** A single {key,value,secret} entry of a project's extension config (secret values redacted on read). */
export interface ConfigEntry {
  key: string;
  value: string | null;
  secret: boolean;
}

/**
 * Lifecycle state of a stored bundle version.
 *
 *  pending — stored and being handed out, but nothing has confirmed it loads.
 *  running — an extension loaded it and published its schema. Once a version
 *            reaches this it is never demoted.
 *  failed  — it could not be loaded (`reason` says why). The integration layer
 *            stops handing it out and the version beneath it takes over.
 */
export type ExtensionState = "pending" | "running" | "failed";

/** The stored bundle's metadata (integration layer `ExtensionMeta`). */
export interface ExtensionMeta {
  projectKey: string;
  length: number;
  uploadedAt: number;
  version: number;
  updatedBy?: string;
  filename?: string;
  /**
   * The integrator's own version-control revision the stored bundle was built from,
   * as reported on upload. Absent for a bundle uploaded without one (e.g. by hand in
   * the Merchant Center).
   */
  sourceRevision?: string;
  /**
   * Lifecycle state of THIS version. Absent when talking to an integration layer
   * that predates bundle state — callers must treat `undefined` as "this deployment
   * can't tell me", not as a failure.
   */
  state?: ExtensionState;
  /** Why this version failed to load; only ever set alongside state "failed". */
  reason?: string;
  /**
   * The version actually in use, which is NOT always `version`: when the newest
   * upload failed to load, the integration layer serves the one beneath it and this
   * reports that older one. `null` when nothing is in use. Returned by the meta read
   * only, not by an upload's response.
   *
   * It carries the source revision as well as the number, because the number is the
   * integration layer's own counter — the commit is what identifies the build to
   * whoever pushed it.
   */
  served?: {
    version: number;
    sourceRevision?: string;
  } | null;
}

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

function apiRoot(baseUrl: string, projectKey: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(projectKey)}`;
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** GET the project's raw core-subgraph SDL — the compose input (`GET …/subgraph`). */
export async function fetchSubgraphSdl(
  baseUrl: string,
  projectKey: string,
  token: string,
): Promise<string> {
  const url = `${apiRoot(baseUrl, projectKey)}/subgraph`;
  const res = await fetch(url, { headers: { accept: "text/plain", ...bearer(token) } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`could not fetch core-subgraph SDL (${res.status}) from ${url}: ${text}`);
  }
  return text;
}

/** POST a candidate SDL to the composition + breaking-change gate (`POST …/extension/validate`). */
export async function remoteValidate(
  baseUrl: string,
  projectKey: string,
  token: string,
  typeDefs: string,
): Promise<RemoteValidationResult> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/validate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({ typeDefs }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`schema validation request failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as RemoteValidationResult;
}

/**
 * Upload the built bundle, replacing the project's stored one (`PUT …/extension/bundle`).
 *
 * `sourceRevision` (optional) records which of the integrator's revisions this build
 * came from; the integration layer stores it against the revision, shows it in the
 * Merchant Center, and hands it to the connector.
 */
export async function pushBundle(
  baseUrl: string,
  projectKey: string,
  token: string,
  bundle: string,
  filename: string,
  sourceRevision?: string,
): Promise<ExtensionMeta> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/bundle`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "text/javascript",
      // The route requires the original filename (percent-encoded; it carries the
      // module's type). The bundle is plain CommonJS, so name it `.cjs`.
      "x-extension-filename": encodeURIComponent(filename),
      // Percent-encoded for the same reason as the filename: keep an arbitrary value
      // header-safe. Omitted entirely when there's no revision to report — the route
      // treats a missing header as "no revision", not an error.
      ...(sourceRevision
        ? { "x-extension-source-revision": encodeURIComponent(sourceRevision) }
        : {}),
      ...bearer(token),
    },
    body: bundle,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PUT extension/bundle failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as ExtensionMeta;
}

/** The stored bundle's metadata, or null if none is stored (`GET …/extension/bundle/meta`). */
export async function fetchExtensionMeta(
  baseUrl: string,
  projectKey: string,
  token: string,
): Promise<ExtensionMeta | null> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/bundle/meta`;
  const res = await fetch(url, { headers: { accept: "application/json", ...bearer(token) } });
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET extension/bundle/meta failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as ExtensionMeta;
}

/** Remove the project's extension subgraph from Hive (`DELETE …/extension/subgraph`). */
export async function deleteExtensionSubgraph(
  baseUrl: string,
  projectKey: string,
  token: string,
): Promise<void> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/subgraph`;
  const res = await fetch(url, { method: "DELETE", headers: { ...bearer(token) } });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`DELETE extension/subgraph failed (${res.status}): ${text}`);
  }
}

/** List the project's extension config entries, secret values redacted (`GET …/extension/config`). */
export async function listConfig(
  baseUrl: string,
  projectKey: string,
  token: string,
): Promise<ConfigEntry[]> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/config`;
  const res = await fetch(url, { headers: { accept: "application/json", ...bearer(token) } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET extension/config failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as ConfigEntry[];
}

/**
 * Upsert/delete config entries and return the resulting (redacted) list
 * (`PATCH …/extension/config`). An entry with `value: null` deletes that key. PATCH
 * (not PUT) so a single set/unset touches one key without clobbering the rest.
 */
export async function patchConfig(
  baseUrl: string,
  projectKey: string,
  token: string,
  entries: Array<{ key: string; value: string | null; secret?: boolean }>,
): Promise<ConfigEntry[]> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/config`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify(entries),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PATCH extension/config failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as ConfigEntry[];
}
