import { afterEach, describe, expect, it, vi } from "vitest";

import ConfigGet from "../../../src/commands/integration-layer/config/get.js";
import ConfigList from "../../../src/commands/integration-layer/config/list.js";
import ConfigSet from "../../../src/commands/integration-layer/config/set.js";
import ConfigUnset from "../../../src/commands/integration-layer/config/unset.js";
import type { IlContext } from "../../../src/lib/base.js";

const BASE = "https://extensions.integration-layer.eu-central-1.aws.commercetools.com";
const PROJECT = "my-project";

const ENVELOPE = {
  entries: [
    { key: "VENDOR_HOST", value: "api.vendor.com", secret: false },
    { key: "API_KEY", value: null, secret: true },
  ],
  maskExtensionGraphQLErrors: true,
};

/**
 * Run a config command against a stubbed IL context (no real login). The command's
 * `init` is a no-op so AuthCommand doesn't demand a principal; `resolveIlContext`
 * hands back the stub fetch. That is the same path that threw
 * `TypeError: entries is not iterable` when the IL started wrapping GET/PATCH in
 * `{ entries, maskExtensionGraphQLErrors }`.
 */
async function runCommand(
  Command: typeof ConfigList | typeof ConfigGet | typeof ConfigSet | typeof ConfigUnset,
  argv: string[],
  fetchImpl: typeof fetch,
): Promise<{ out: string; error?: Error }> {
  const ctx: IlContext = { baseUrl: BASE, projectKey: PROJECT, authFetch: fetchImpl };
  const proto = Command.prototype as unknown as {
    init: () => Promise<void>;
    resolveIlContext: () => Promise<IlContext>;
    log: (...a: unknown[]) => void;
  };
  const initSpy = vi.spyOn(proto, "init").mockResolvedValue(undefined);
  const ctxSpy = vi.spyOn(proto, "resolveIlContext").mockResolvedValue(ctx);
  const out: string[] = [];
  const logSpy = vi.spyOn(proto, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(" "));
  });
  let error: Error | undefined;
  try {
    await Command.run(argv);
  } catch (e) {
    error = e as Error;
  } finally {
    initSpy.mockRestore();
    ctxSpy.mockRestore();
    logSpy.mockRestore();
  }
  return { out: out.join("\n"), error };
}

function stubFetch(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("integration-layer config list", () => {
  it("prints keys from the { entries, maskExtensionGraphQLErrors } envelope", async () => {
    const authFetch = stubFetch(new Response(JSON.stringify(ENVELOPE), { status: 200 }));

    const { out, error } = await runCommand(ConfigList, [], authFetch);

    expect(error).toBeUndefined();
    expect(out).toContain("VENDOR_HOST = api.vendor.com");
    expect(out).toContain("API_KEY = •••••• (secret)");
  });

  it("says so when the envelope carries no entries", async () => {
    const authFetch = stubFetch(
      new Response(JSON.stringify({ entries: [], maskExtensionGraphQLErrors: true }), {
        status: 200,
      }),
    );

    const { out, error } = await runCommand(ConfigList, [], authFetch);

    expect(error).toBeUndefined();
    expect(out).toContain(`No extension config entries for '${PROJECT}'.`);
  });
});

describe("integration-layer config get", () => {
  it("finds one key on the unwrapped entries (not on the envelope object)", async () => {
    const authFetch = stubFetch(new Response(JSON.stringify(ENVELOPE), { status: 200 }));

    const { out, error } = await runCommand(ConfigGet, ["VENDOR_HOST"], authFetch);

    expect(error).toBeUndefined();
    expect(out).toBe("VENDOR_HOST = api.vendor.com");
  });

  it("errors when the key is absent", async () => {
    const authFetch = stubFetch(new Response(JSON.stringify(ENVELOPE), { status: 200 }));

    const { error } = await runCommand(ConfigGet, ["MISSING"], authFetch);

    expect(error?.message).toMatch(/No config entry 'MISSING'/);
  });
});

describe("integration-layer config set", () => {
  it("PATCHes { entries } and does not send a bare array", async () => {
    const authFetch = stubFetch(new Response(JSON.stringify(ENVELOPE), { status: 200 }));

    const { out, error } = await runCommand(ConfigSet, ["ALGOLIA_APP_ID", "abc123"], authFetch);

    expect(error).toBeUndefined();
    expect(out).toContain(`✓ set 'ALGOLIA_APP_ID' for '${PROJECT}'.`);
    const [, init] = (authFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      entries: [{ key: "ALGOLIA_APP_ID", value: "abc123", secret: false }],
    });
  });
});

describe("integration-layer config unset", () => {
  it("PATCHes { entries: [{ key, value: null }] } to delete the key", async () => {
    const authFetch = stubFetch(
      new Response(JSON.stringify({ entries: [], maskExtensionGraphQLErrors: true }), {
        status: 200,
      }),
    );

    const { out, error } = await runCommand(ConfigUnset, ["STALE"], authFetch);

    expect(error).toBeUndefined();
    expect(out).toContain(`✓ removed 'STALE' from '${PROJECT}'.`);
    const [, init] = (authFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      entries: [{ key: "STALE", value: null }],
    });
  });
});
