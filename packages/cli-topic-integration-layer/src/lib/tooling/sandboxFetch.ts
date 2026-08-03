// Allowlist-gated `fetch` for the local `serve` dev server — the same merchant
// `allow` list production enforces, plus loopback hosts (localhost/127.0.0.0/8/::1)
// which are always permitted locally so an extension can reach a service on the
// dev machine while you iterate (see isLocalhost). Resolvers run through
// {@link wrapResolverMap} so only extension code sees this wrapper; the gateway
// and integration-layer client keep the real Node `fetch`.

import { AsyncLocalStorage } from "node:async_hooks";

/** Supplies the current allow patterns, re-read on every sandbox `fetch` call. */
export type AllowlistProvider = () => readonly string[];

/** Does `hostname` match any allowlist pattern? */
function hostAllowed(hostname: string, allowlist: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowlist.some((pattern) => {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      return host === suffix || host.endsWith(`.${suffix}`);
    }
    return host === pattern;
  });
}

/**
 * Loopback hosts served by the developer's own machine. `serve` always permits
 * these regardless of the merchant allow list, so an extension can reach a service
 * running locally (a mock, a companion API) while you iterate. This is a
 * LOCAL-DEV-ONLY affordance: the deployed sandbox enforces only the real allow
 * list, and localhost is never on it — so nothing here loosens production.
 * Covers `localhost` (and any `*.localhost` subdomain), the IPv4 loopback range
 * `127.0.0.0/8`, and IPv6 `::1` (brackets stripped as the WHATWG URL keeps them).
 */
function isLocalhost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  const url = (input as { url?: unknown }).url;
  return typeof url === "string" ? url : String(input);
}

/**
 * Build the allowlist-gated `fetch` the production sandbox endows. Throws a `TypeError`
 * — like `fetch` on failure — when the destination is not on the allow list.
 */
export function createSandboxFetch(allowlistProvider: AllowlistProvider): typeof fetch {
  const realFetch = globalThis.fetch.bind(globalThis);
  const sandboxFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Awaited<ReturnType<typeof fetch>>> => {
    let parsed: URL;
    try {
      parsed = new URL(requestUrl(input));
    } catch {
      throw new TypeError(`fetch: invalid URL "${requestUrl(input)}"`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new TypeError(`fetch: unsupported protocol "${parsed.protocol}"`);
    }
    const host = parsed.hostname;
    // Loopback is always reachable locally (see isLocalhost); everything else must
    // be on the merchant allow list, exactly as production enforces.
    if (!isLocalhost(host) && !hostAllowed(host, allowlistProvider())) {
      throw new TypeError(`fetch: host "${host}" is not in the extension HTTP allowlist`);
    }
    return realFetch(input, { ...init, redirect: "manual" });
  };
  return sandboxFetch as typeof fetch;
}

const sandboxFetchStorage = new AsyncLocalStorage<typeof fetch>();

/**
 * Route `globalThis.fetch` through the sandbox wrapper when a resolver runs inside
 * {@link wrapResolverMap}. Returns a restore function for shutdown.
 */
export function installDelegatingFetch(): () => void {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input, init) => {
    const fn = sandboxFetchStorage.getStore() ?? realFetch;
    return fn(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

/** Wrap every resolver so its `fetch` calls use the allowlist-gated wrapper. */
export function wrapResolverMap(resolvers: object, sandboxFetch: typeof fetch): object {
  const wrap = (value: unknown): unknown => {
    if (typeof value === "function") {
      const fn = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => sandboxFetchStorage.run(sandboxFetch, () => fn(...args));
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, wrap(v)]),
      );
    }
    return value;
  };
  return wrap(resolvers) as object;
}
