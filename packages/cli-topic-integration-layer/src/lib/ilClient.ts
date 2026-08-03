// Low-level HTTP client for the Commerce Integration Layer's per-project manage-surface
// routes. Every call is parameterised by (baseUrl, projectKey, authFetch) — the command
// layer resolves those (`IntegrationLayerCommand.resolveIlContext`), and this module just
// speaks the wire protocol. `authFetch` is the `CtpAuthFetchFactory` fetch: it injects the
// `manage_project` bearer and transparently refreshes/retries it, so nothing here sets an
// Authorization header itself. The route bodies these mirror live in the integration
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
 *  failed  — it could not be loaded (`reason` says why). The Commerce Integration Layer
 *            stops handing it out and the version beneath it takes over.
 */
export type ExtensionState = "pending" | "running" | "failed";

/** The stored bundle's metadata (Commerce Integration Layer `ExtensionMeta`). */
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
   * Lifecycle state of THIS version. Absent when talking to a Commerce Integration Layer
   * that predates bundle state — callers must treat `undefined` as "this deployment
   * can't tell me", not as a failure.
   */
  state?: ExtensionState;
  /** Why this version failed to load; only ever set alongside state "failed". */
  reason?: string;
  /**
   * The version actually in use, which is NOT always `version`: when the newest
   * upload failed to load, the Commerce Integration Layer serves the one beneath it and this
   * reports that older one. `null` when nothing is in use. Returned by the meta read
   * only, not by an upload's response.
   *
   * It carries the source revision as well as the number, because the number is the
   * Commerce Integration Layer's own counter — the commit is what identifies the build to
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

/**
 * The authenticated fetch supplied by the command layer — the `CtpAuthFetchFactory` fetch,
 * which injects the `manage_project` bearer and refreshes/retries it. Structurally a
 * `fetch`, so callers can pass a plain stub in tests.
 */
export type AuthFetch = typeof fetch;

/** GET the project's raw core-subgraph SDL — the compose input (`GET …/subgraph`). */
export async function fetchSubgraphSdl(
  baseUrl: string,
  projectKey: string,
  authFetch: AuthFetch,
): Promise<string> {
  const url = `${apiRoot(baseUrl, projectKey)}/subgraph`;
  const res = await authFetch(url, { headers: { accept: "text/plain" } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`could not fetch core-subgraph SDL (${res.status}) from ${url}: ${text}`);
  }
  return text;
}

/**
 * GET the project's DEPLOYED composed graph as a PUBLIC API SCHEMA — what the router
 * actually plans and serves (core subgraph + the project's published extension),
 * read from Hive by the Commerce Integration Layer and reduced there (`GET …/schema/api`).
 *
 * The Commerce Integration Layer strips the federation machinery before sending, so this is
 * `buildSchema`-able as-is; there is no supergraph to reduce client-side. It is the
 * byte-identical response the Merchant Center console's explorer reads under its
 * own operator JWT — one artifact, two guards.
 *
 * This is the authenticated replacement for introspecting the public edge: the
 * router runs `introspection: false`, so the composed graph is read here, over the
 * same `manage_project` boundary as `/subgraph`. 404 means the project has never
 * published a composable version.
 */
export async function fetchDeployedApiSchemaSdl(
  baseUrl: string,
  projectKey: string,
  authFetch: AuthFetch,
): Promise<string> {
  const url = `${apiRoot(baseUrl, projectKey)}/schema/api`;
  const res = await authFetch(url, { headers: { accept: "text/plain" } });
  const text = await res.text();
  if (res.status === 404) {
    throw new Error(
      `project '${projectKey}' has no composed schema published yet — publish one from the ` +
        `Merchant Center console (Schema → Refresh schema), or drop --deployed to compose locally`,
    );
  }
  if (!res.ok) {
    throw new Error(`could not fetch the deployed composed schema (${res.status}) from ${url}: ${text}`);
  }
  return text;
}

/** POST a candidate SDL to the composition + breaking-change gate (`POST …/extension/validate`). */
export async function remoteValidate(
  baseUrl: string,
  projectKey: string,
  authFetch: AuthFetch,
  typeDefs: string,
): Promise<RemoteValidationResult> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/validate`;
  const res = await authFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
 * came from; the Commerce Integration Layer stores it against the revision, shows it in the
 * Merchant Center, and hands it to the connector.
 */
export async function pushBundle(
  baseUrl: string,
  projectKey: string,
  authFetch: AuthFetch,
  bundle: string,
  filename: string,
  sourceRevision?: string,
): Promise<ExtensionMeta> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/bundle`;
  const res = await authFetch(url, {
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
  authFetch: AuthFetch,
): Promise<ExtensionMeta | null> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/bundle/meta`;
  const res = await authFetch(url, { headers: { accept: "application/json" } });
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
  authFetch: AuthFetch,
): Promise<void> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/subgraph`;
  const res = await authFetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`DELETE extension/subgraph failed (${res.status}): ${text}`);
  }
}

/**
 * The project's extension HTTP allowlist: the merchant-tunable `allow` host patterns
 * the extension sandbox's `fetch` may reach, plus the operator `deny` ceiling. A host
 * is permitted iff it matches `allow` AND not `deny`. Patterns are bare hosts —
 * `api.foo.com` or leading-wildcard `*.foo.com` (no scheme, port, or path).
 *
 * `deny` is read-only over HTTP (the operator's veto, edited out-of-band); only
 * `allow` is writable, and only by full replacement (see {@link putAllowlist}).
 */
export interface AllowlistView {
  allow: string[];
  deny: string[];
}

/** GET the project's extension HTTP allowlist (`GET …/extension/allowlist`). */
export async function getAllowlist(
  baseUrl: string,
  projectKey: string,
  authFetch: AuthFetch,
): Promise<AllowlistView> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/allowlist`;
  const res = await authFetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET extension/allowlist failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as AllowlistView;
}

/**
 * Replace the merchant `allow` patterns with `patterns` (`PUT …/extension/allowlist`).
 * The route takes a bare JSON array and REPLACES the whole allow list — the add/remove
 * commands read-modify-write around it. The Commerce Integration Layer validates and normalizes
 * (lowercases, de-dupes, rejects schemes/ports/paths/IPs/over-broad patterns) and
 * returns the stored list plus the config's new monotonic version. The `deny` ceiling
 * is untouched (it has no write route).
 */
export async function putAllowlist(
  baseUrl: string,
  projectKey: string,
  authFetch: AuthFetch,
  patterns: string[],
): Promise<{ allow: string[]; version: number }> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/allowlist`;
  const res = await authFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patterns),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PUT extension/allowlist failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as { allow: string[]; version: number };
}

/** List the project's extension config entries, secret values redacted (`GET …/extension/config`). */
export async function listConfig(
  baseUrl: string,
  projectKey: string,
  authFetch: AuthFetch,
): Promise<ConfigEntry[]> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/config`;
  const res = await authFetch(url, { headers: { accept: "application/json" } });
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
  authFetch: AuthFetch,
  entries: Array<{ key: string; value: string | null; secret?: boolean }>,
): Promise<ConfigEntry[]> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/config`;
  const res = await authFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entries),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PATCH extension/config failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as ConfigEntry[];
}

/** The deployed connector's verdict, as the Commerce Integration Layer's invoke proxy returns it. */
export interface DeployedInvokeResponse {
  /** The connector's own HTTP status: 200 (approve/modify), 400 (block), 401/5xx (fault). */
  status: number;
  /** The connector's response body ({}, { actions }, { errors }, …) — the API-Extension result. */
  result: unknown;
}

/**
 * Fire ONE commercetools API-Extension callback at the project's DEPLOYED extension
 * and return the connector's verdict (`POST …/extension/api-extensions/invoke`).
 *
 * The Commerce Integration Layer is the signing proxy: only it can mint the shared-secret
 * bearer the connector's `/api-extensions` endpoint requires (derived from the
 * project's stored client secret), so the CLI hands it the payload and the integration
 * layer resolves the deployed connector URL, signs, forwards, and returns the result.
 * Nothing is persisted to commercetools — it is the callback in isolation.
 *
 * A connector that ANSWERS — including a 400 block — comes back inside the
 * `{ status, result }` envelope (a block is a verdict, not a failure). This throws
 * only when the deployed extension could not be REACHED (no deployment, no service
 * URL yet, timeout) or the request was rejected (not enrolled, unauthorized).
 */
export async function invokeDeployedApiExtension(
  baseUrl: string,
  projectKey: string,
  authFetch: AuthFetch,
  input: { action: string; resource: { typeId: string } },
): Promise<DeployedInvokeResponse> {
  const url = `${apiRoot(baseUrl, projectKey)}/extension/api-extensions/invoke`;
  const res = await authFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      // Non-JSON body — surface it raw.
    }
    throw new Error(`could not invoke the deployed extension (${res.status}): ${detail}`);
  }
  return JSON.parse(text) as DeployedInvokeResponse;
}
