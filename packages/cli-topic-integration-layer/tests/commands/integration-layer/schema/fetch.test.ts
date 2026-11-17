import { afterEach, describe, expect, it, vi } from "vitest";

import SchemaFetch from "../../../../src/commands/integration-layer/schema/fetch.js";
import type { IlContext } from "../../../../src/lib/base.js";
import * as ilClient from "../../../../src/lib/ilClient.js";

vi.mock("../../../../src/lib/ilClient.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/ilClient.js")>()),
  fetchPublicApiSchemaSdl: vi.fn(),
  fetchSubgraphSdl: vi.fn(),
}));

async function runFetch(argv: string[]): Promise<string> {
  vi.mocked(ilClient.fetchPublicApiSchemaSdl).mockResolvedValue("PUBLIC SDL");
  vi.mocked(ilClient.fetchSubgraphSdl).mockResolvedValue("SUBGRAPH SDL");
  const ctx: IlContext = {
    baseUrl: "https://example.test",
    projectKey: "my-project",
    authFetch: vi.fn() as unknown as typeof fetch,
  };
  const proto = SchemaFetch.prototype as unknown as {
    init: () => Promise<void>;
    resolveIlContext: () => Promise<IlContext>;
    log: (...a: unknown[]) => void;
  };
  vi.spyOn(proto, "init").mockResolvedValue(undefined);
  vi.spyOn(proto, "resolveIlContext").mockResolvedValue(ctx);
  const out: string[] = [];
  vi.spyOn(proto, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(" "));
  });
  await SchemaFetch.run(argv);
  return out.join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("integration-layer schema fetch", () => {
  it("prints the core subgraph by default", async () => {
    expect(await runFetch([])).toBe("SUBGRAPH SDL");
    expect(ilClient.fetchSubgraphSdl).toHaveBeenCalledOnce();
    expect(ilClient.fetchPublicApiSchemaSdl).not.toHaveBeenCalled();
  });

  it("prints the public API schema with --public", async () => {
    expect(await runFetch(["--public"])).toBe("PUBLIC SDL");
    expect(ilClient.fetchPublicApiSchemaSdl).toHaveBeenCalledOnce();
    expect(ilClient.fetchSubgraphSdl).not.toHaveBeenCalled();
  });
});
