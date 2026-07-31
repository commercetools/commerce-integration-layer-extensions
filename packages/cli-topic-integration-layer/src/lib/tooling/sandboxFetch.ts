// Allowlist-gated `fetch` for the local `serve` dev server — the same host rules the
// production extension sandbox enforces (merchant `allow` + operator `deny`). Resolvers
// run through {@link wrapResolverMap} so only extension code sees this wrapper; the
// gateway and integration-layer client keep the real Node `fetch`.
//
// Copied from octolog-extensions-sandbox/service/src/bundle/http.ts (minus OTel).

import { AsyncLocalStorage } from "node:async_hooks";

/** The two host-pattern lists governing extension egress. */
export interface AllowlistRules {
  allow: string[];
  deny: string[];
}

/** Supplies the current rules, re-read on every sandbox `fetch` call. */
export type AllowlistProvider = () => AllowlistRules;

/** Does `hostname` match any allowlist pattern? */
function hostAllowed(hostname: string, patterns: string[]): boolean {
  const host = hostname.toLowerCase();
  return patterns.some((pattern) => {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      return host === suffix || host.endsWith(`.${suffix}`);
    }
    return host === pattern;
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  const url = (input as { url?: unknown }).url;
  return typeof url === "string" ? url : String(input);
}

/**
 * Build the allowlist-gated `fetch` the production sandbox endows. Throws a `TypeError`
 * — like `fetch` on failure — when the destination is not permitted.
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
    const { allow, deny } = allowlistProvider();
    if (!hostAllowed(host, allow)) {
      throw new TypeError(`fetch: host "${host}" is not in the extension HTTP allowlist`);
    }
    if (hostAllowed(host, deny)) {
      throw new TypeError(`fetch: host "${host}" is blocked by the extension HTTP deny list`);
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
