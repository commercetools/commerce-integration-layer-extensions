// Minimal client for the commercetools Composable Commerce **API Extensions**
// resource (`/{projectKey}/extensions`), used ONLY by `serve-api-extension` to point
// a project at a locally-served bundle for end-to-end debugging.
//
// Unlike `ilClient.ts` (which talks to the Commerce Integration Layer edge), this
// talks to the commercetools platform API directly — the same authenticated fetch
// carries a real `manage_project` bearer, so nothing here sets an Authorization
// header itself. The commercetools API host follows the same `<svc>.<region>` scheme
// as the auth/connect hosts (`api.<region>.commercetools.com`); the region comes
// from the logged-in principal.
//
// SAFETY MODEL: this registers callbacks that make commercetools call the developer's
// machine, so it is intentionally conservative. `serve-api-extension` REFUSES to run
// against a project that already has ANY Extension (so it can never disturb a real
// one), owns everything it creates under the `il-localdev-` key prefix, and deletes
// what it created on exit. This module supplies the pure, unit-tested pieces of that
// contract (key/draft/reconcile) plus the three REST calls.

import type { ApiExtensionDefinition } from "./tooling/apiExtension.js";

/**
 * The authenticated fetch supplied by the command layer — the `CtpAuthFetchFactory`
 * fetch, which injects the `manage_project` bearer and refreshes/retries it.
 * Structurally a `fetch`, so callers can pass a plain stub in tests.
 */
export type AuthFetch = typeof fetch;

/** The commercetools platform API base for a login region (e.g. `eu-central-1.aws`). */
export function ctApiBaseUrl(region: string): string {
  const trimmed = region.trim();
  if (!trimmed) {
    throw new Error(
      "no commercetools region on the login — run `commercetools auth login --project-key <key>`",
    );
  }
  return `https://api.${trimmed}.commercetools.com`;
}

/** Every Extension `serve-api-extension` creates is keyed under this prefix, so it can
 * find and remove exactly (and only) its own, and never touch a real one. */
export const MANAGED_KEY_PREFIX = "il-localdev-";

/** The commercetools Extension key for one of the bundle's declarations. */
export function managedKey(authorKey: string): string {
  return `${MANAGED_KEY_PREFIX}${authorKey}`;
}

/** Whether an Extension key was created by this command (safe to delete on cleanup). */
export function isManagedKey(key: string | undefined): boolean {
  return typeof key === "string" && key.startsWith(MANAGED_KEY_PREFIX);
}

interface ExtensionTrigger {
  resourceTypeId: string;
  actions: string[];
  condition?: string;
}

/** The commercetools ExtensionDraft body — an HTTP destination with a shared-secret
 * Authorization header, plus the triggers derived from one bundle declaration. */
export interface ExtensionDraft {
  key: string;
  destination: {
    type: "HTTP";
    url: string;
    authentication: { type: "AuthorizationHeader"; headerValue: string };
  };
  triggers: ExtensionTrigger[];
}

/** One Extension as returned by commercetools (trimmed to what we reference). */
export interface ExtensionSummary {
  id: string;
  key?: string;
  version: number;
}

/**
 * Build the commercetools ExtensionDraft for one declaration: destination = the local
 * server's public `/api-extensions` URL, authentication = the shared secret this
 * command minted (commercetools sends it back as the `Authorization` header, which the
 * local server verifies). The `headerValue` is the FULL header value, so callers pass
 * e.g. `Bearer <secret>`.
 */
export function draftFor(
  decl: ApiExtensionDefinition,
  callbackUrl: string,
  authorizationHeaderValue: string,
): ExtensionDraft {
  return {
    key: managedKey(decl.key),
    destination: {
      type: "HTTP",
      url: callbackUrl,
      authentication: { type: "AuthorizationHeader", headerValue: authorizationHeaderValue },
    },
    triggers: [
      {
        resourceTypeId: decl.resourceTypeId,
        actions: [...decl.actions],
        ...(decl.condition !== undefined ? { condition: decl.condition } : {}),
      },
    ],
  };
}

/**
 * A stable fingerprint of a declaration's TRIGGER shape (resource + actions +
 * condition). The reconcile step recreates an Extension only when this changes; a
 * handler-body edit leaves it identical, so no commercetools round trip is needed.
 */
export function triggerSignature(decl: ApiExtensionDefinition): string {
  return JSON.stringify({
    resourceTypeId: decl.resourceTypeId,
    actions: [...decl.actions].sort(),
    condition: decl.condition ?? null,
  });
}

/** An Extension this command created and is tracking, so it can update/delete it. */
export interface RegisteredExtension {
  /** The author's declaration key (unprefixed). */
  authorKey: string;
  /** The commercetools resource id (needed to delete). */
  id: string;
  /** The current commercetools version (needed to delete). */
  version: number;
  /** {@link triggerSignature} at the time it was created. */
  signature: string;
}

export interface ReconcilePlan {
  /** Declarations to (re)create — new, or whose trigger shape changed. */
  toCreate: ApiExtensionDefinition[];
  /** Registered Extensions to delete — gone, or superseded by a changed one. */
  toDelete: RegisteredExtension[];
}

/**
 * Diff what we've registered against the bundle's current declarations. Pure so it's
 * unit-tested directly. An Extension whose trigger signature changed appears in BOTH
 * lists (delete the stale one, create the new one); a handler-only edit appears in
 * neither.
 */
export function planReconcile(
  registered: readonly RegisteredExtension[],
  desired: readonly ApiExtensionDefinition[],
): ReconcilePlan {
  const registeredByKey = new Map(registered.map((r) => [r.authorKey, r]));
  const desiredByKey = new Map(desired.map((d) => [d.key, d]));

  const toCreate = desired.filter((d) => {
    const existing = registeredByKey.get(d.key);
    return !existing || existing.signature !== triggerSignature(d);
  });
  const toDelete = registered.filter((r) => {
    const want = desiredByKey.get(r.authorKey);
    return !want || triggerSignature(want) !== r.signature;
  });
  return { toCreate, toDelete };
}

function extensionsUrl(base: string, projectKey: string): string {
  return `${base}/${encodeURIComponent(projectKey)}/extensions`;
}

/** List the project's Extensions (one page; enough for the "refuse if any present"
 * guard and for sweeping our own leftovers). */
export async function listExtensions(
  apiBaseUrl: string,
  projectKey: string,
  authFetch: AuthFetch,
  limit = 100,
): Promise<ExtensionSummary[]> {
  const url = `${extensionsUrl(apiBaseUrl, projectKey)}?limit=${limit}`;
  const res = await authFetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET /extensions failed (${res.status}) for '${projectKey}': ${text}`);
  }
  const body = JSON.parse(text) as { results?: ExtensionSummary[] };
  return body.results ?? [];
}

/** Create one Extension; returns its id + version (needed to delete it later). */
export async function createExtension(
  apiBaseUrl: string,
  projectKey: string,
  authFetch: AuthFetch,
  draft: ExtensionDraft,
): Promise<ExtensionSummary> {
  const res = await authFetch(extensionsUrl(apiBaseUrl, projectKey), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(draft),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /extensions '${draft.key}' failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as ExtensionSummary;
}

/** Delete one Extension by id + version (idempotent: a 404 is treated as done). */
export async function deleteExtension(
  apiBaseUrl: string,
  projectKey: string,
  authFetch: AuthFetch,
  id: string,
  version: number,
): Promise<void> {
  const url = `${extensionsUrl(apiBaseUrl, projectKey)}/${encodeURIComponent(id)}?version=${version}`;
  const res = await authFetch(url, { method: "DELETE", headers: { accept: "application/json" } });
  if (res.ok || res.status === 404) return;
  const text = await res.text();
  throw new Error(`DELETE /extensions/${id} failed (${res.status}): ${text}`);
}
