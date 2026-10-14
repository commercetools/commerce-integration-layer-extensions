import { afterEach, describe, expect, it, vi } from "vitest";

import ExtensionStatus from "../../../../src/commands/integration-layer/extension/status.js";
import type { IlContext } from "../../../../src/lib/base.js";
import * as ilClient from "../../../../src/lib/ilClient.js";
import type { ExtensionMeta } from "../../../../src/lib/ilClient.js";

vi.mock("../../../../src/lib/ilClient.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/ilClient.js")>()),
  fetchExtensionMeta: vi.fn(),
}));

const baseMeta: ExtensionMeta = {
  projectKey: "my-project",
  length: 100,
  uploadedAt: 1_700_000_000_000,
  version: 5,
};

async function runStatus(meta: ExtensionMeta | null): Promise<string> {
  vi.mocked(ilClient.fetchExtensionMeta).mockResolvedValue(meta);
  const ctx: IlContext = {
    baseUrl: "https://example.test",
    projectKey: "my-project",
    authFetch: vi.fn() as unknown as typeof fetch,
  };
  const proto = ExtensionStatus.prototype as unknown as {
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
  await ExtensionStatus.run([]);
  return out.join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("integration-layer extension status", () => {
  it("reports when nothing is stored", async () => {
    expect(await runStatus(null)).toContain("No extension bundle is stored");
  });

  it("prints a running state and a served version equal to the newest", async () => {
    const out = await runStatus({
      ...baseMeta,
      state: "running",
      served: { version: 5, sourceRevision: "abc123" },
    });
    expect(out).toContain("state:      running");
    expect(out).not.toContain("reason:");
    expect(out).toContain("served:     v5 (built from abc123) — same as the newest stored version");
  });

  it("prints the reason and the older served version when the newest failed", async () => {
    const out = await runStatus({
      ...baseMeta,
      state: "failed",
      reason: "syntax error",
      served: { version: 4 },
    });
    expect(out).toContain("state:      failed");
    expect(out).toContain("reason:     syntax error");
    expect(out).toContain("served:     v4 — older than the newest stored version (v5)");
    expect(out).toContain("the newest failed to load");
  });

  it("says nothing is served when served is null", async () => {
    const out = await runStatus({ ...baseMeta, state: "failed", reason: "x", served: null });
    expect(out).toContain("served:     nothing");
  });

  it("treats an absent state/served as unknown, not as a failure", async () => {
    const out = await runStatus(baseMeta);
    expect(out).toContain("state:      unknown");
    expect(out).not.toContain("reason:");
    expect(out).not.toContain("served:");
  });

  it("omits the reason for a pending state", async () => {
    const out = await runStatus({ ...baseMeta, state: "pending", reason: "stale" });
    expect(out).toContain("state:      pending");
    expect(out).not.toContain("reason:");
  });
});
