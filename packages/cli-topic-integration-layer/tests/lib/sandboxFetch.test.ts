import { describe, expect, it } from "vitest";
import {
  createSandboxFetch,
  installDelegatingFetch,
  wrapResolverMap,
} from "../../src/lib/tooling/sandboxFetch.js";

function jsonResponse(status: number, body: string): Awaited<ReturnType<typeof fetch>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
    headers: { get: () => null },
  } as unknown as Awaited<ReturnType<typeof fetch>>;
}

async function withFetchStub<T>(
  handler: (url: string, init?: Parameters<typeof fetch>[1]) => Awaited<ReturnType<typeof fetch>>,
  fn: (calls: { url: string; init?: Parameters<typeof fetch>[1] }[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: { url: string; init?: Parameters<typeof fetch>[1] }[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

describe("createSandboxFetch", () => {
  it("refuses a host that is not on the allowlist before any socket opens", async () => {
    await withFetchStub(
      () => jsonResponse(200, "{}"),
      async (calls) => {
        const sandboxFetch = createSandboxFetch(() => ["*.algolia.net"]);
        await expect(sandboxFetch("https://evil.example.com/steal")).rejects.toThrow(
          /not in the extension HTTP allowlist/,
        );
        expect(calls).toHaveLength(0);
      },
    );
  });

  it("re-reads the provider on each call", async () => {
    await withFetchStub(
      () => jsonResponse(200, "{}"),
      async (calls) => {
        let allow: string[] = [];
        const sandboxFetch = createSandboxFetch(() => allow);
        await expect(sandboxFetch("https://x.algolia.net/y")).rejects.toThrow(
          /not in the extension HTTP allowlist/,
        );
        allow = ["*.algolia.net"];
        const res = await sandboxFetch("https://x.algolia.net/y");
        expect(res.status).toBe(200);
        expect(calls).toHaveLength(1);
      },
    );
  });

  it("always allows loopback hosts locally, even with an empty allowlist", async () => {
    await withFetchStub(
      () => jsonResponse(200, "{}"),
      async (calls) => {
        const sandboxFetch = createSandboxFetch(() => []);
        for (const url of [
          "http://localhost:4010/x",
          "http://127.0.0.1:4010/x",
          "http://mock.localhost:4010/x",
          "http://[::1]:4010/x",
        ]) {
          const res = await sandboxFetch(url);
          expect(res.status).toBe(200);
        }
        expect(calls).toHaveLength(4);
      },
    );
  });

  it("still refuses a non-loopback host that only looks local", async () => {
    await withFetchStub(
      () => jsonResponse(200, "{}"),
      async (calls) => {
        const sandboxFetch = createSandboxFetch(() => []);
        await expect(sandboxFetch("http://localhost.evil.com/x")).rejects.toThrow(
          /not in the extension HTTP allowlist/,
        );
        expect(calls).toHaveLength(0);
      },
    );
  });

  it("allows an allowlisted host and forces redirect: manual", async () => {
    await withFetchStub(
      () => jsonResponse(200, JSON.stringify({ value: "pong" })),
      async (calls) => {
        const sandboxFetch = createSandboxFetch(() => ["*.algolia.net"]);
        const res = await sandboxFetch("https://abc-dsn.algolia.net/1/x", {
          method: "POST",
          headers: { "x-test": "1" },
          body: "{}",
        });
        expect(res.status).toBe(200);
        expect(calls[0]?.init?.redirect).toBe("manual");
      },
    );
  });
});

describe("wrapResolverMap + installDelegatingFetch", () => {
  it("routes resolver fetch through the sandbox wrapper without affecting other fetch calls", async () => {
    await withFetchStub(
      () => jsonResponse(200, "{}"),
      async (calls) => {
        const sandboxFetch = createSandboxFetch(() => ["catfact.ninja"]);
        const restore = installDelegatingFetch();
        try {
          const resolvers = wrapResolverMap(
            {
              Query: {
                blocked: async () => {
                  await fetch("https://evil.example.com/x");
                  return "nope";
                },
                allowed: async () => {
                  await fetch("https://catfact.ninja/fact");
                  return "ok";
                },
              },
            },
            sandboxFetch,
          );
          await expect((resolvers as { Query: { blocked: () => Promise<string> } }).Query.blocked()).rejects.toThrow(
            /not in the extension HTTP allowlist/,
          );
          expect(calls).toHaveLength(0);

          await (resolvers as { Query: { allowed: () => Promise<string> } }).Query.allowed();
          expect(calls).toHaveLength(1);
          expect(calls[0]?.url).toContain("catfact.ninja");

          await globalThis.fetch("https://evil.example.com/outside-resolver");
          expect(calls).toHaveLength(2);
        } finally {
          restore();
        }
      },
    );
  });
});
