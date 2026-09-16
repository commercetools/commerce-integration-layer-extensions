import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import ExtensionPull from "../../../../src/commands/integration-layer/extension/pull.js";
import type { IlContext } from "../../../../src/lib/base.js";

const BASE = "https://extensions.integration-layer.eu-central-1.aws.commercetools.com";
const PROJECT = "my-project";

/**
 * Run the pull command against a stubbed IL context (no real login). `init` is a
 * no-op so AuthCommand doesn't demand a principal, and `resolveIlContext` hands back
 * the stub fetch — the same seam the config command tests use.
 */
async function runPull(
  argv: string[],
  fetchImpl: typeof fetch,
): Promise<{ out: string; error?: Error }> {
  const ctx: IlContext = { baseUrl: BASE, projectKey: PROJECT, authFetch: fetchImpl };
  const proto = ExtensionPull.prototype as unknown as {
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
    await ExtensionPull.run(argv);
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

describe("integration-layer extension pull", () => {
  it("writes the downloaded bundle to --out and reports version + source revision", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-cli-pull-"));
    const out = join(dir, "dist", "extension.cjs");
    const body = "module.exports = { typeDefs: 'type Query { ping: String }' }";
    const authFetch = stubFetch(
      new Response(body, {
        status: 200,
        headers: {
          "Content-Disposition": 'attachment; filename="extension.cjs"',
          "X-Extension-Version": "3",
          "X-Extension-Source-Revision": "r99",
        },
      }),
    );

    const { out: logs, error } = await runPull(["--out", out], authFetch);

    expect(error).toBeUndefined();
    expect(await readFile(out, "utf8")).toBe(body);
    expect(logs).toContain(`wrote ${Buffer.byteLength(body)} bytes → ${out}`);
    expect(logs).toContain("version:     3");
    expect(logs).toContain("built from:  r99");
    const [url] = (authFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE}/${PROJECT}/extension/bundle`);
  });

  it("says so and writes nothing when the project has no stored bundle", async () => {
    const authFetch = stubFetch(
      new Response(JSON.stringify({ error: "No extension code stored for this project" }), {
        status: 404,
      }),
    );

    const { out, error } = await runPull([], authFetch);

    expect(error).toBeUndefined();
    expect(out).toContain(`No extension bundle is stored for '${PROJECT}'.`);
  });
});
