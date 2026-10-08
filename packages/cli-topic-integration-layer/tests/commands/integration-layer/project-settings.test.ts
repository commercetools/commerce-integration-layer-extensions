import { afterEach, describe, expect, it, vi } from "vitest";

import SettingsGet from "../../../src/commands/integration-layer/project-settings/get.js";
import SettingsSet from "../../../src/commands/integration-layer/project-settings/set.js";
import type { IlContext } from "../../../src/lib/base.js";

const BASE = "https://extensions.integration-layer.eu-central-1.aws.commercetools.com";
const PROJECT = "my-project";

const CURRENT = { label: "Acme", language: "en-US", currency: "USD", country: "US" };
const GET_BODY = { project: CURRENT, platform: { regionId: "eu-central-1" }, version: 2 };

async function runCommand(
  Command: typeof SettingsGet | typeof SettingsSet,
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

/** GET returns the current settings; PUT echoes the body back as `{ project, version }`. */
function settingsFetch() {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      return new Response(JSON.stringify({ project: JSON.parse(String(init.body)), version: 3 }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify(GET_BODY), { status: 200 });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("integration-layer project-settings get", () => {
  it("prints the four settings and the read-only region", async () => {
    const { out, error } = await runCommand(
      SettingsGet,
      [],
      settingsFetch() as unknown as typeof fetch,
    );
    expect(error).toBeUndefined();
    expect(out).toContain("label:    Acme");
    expect(out).toContain("currency: USD");
    expect(out).toContain("eu-central-1 (read-only)");
  });

  it("prints only the project section with --json", async () => {
    const { out } = await runCommand(
      SettingsGet,
      ["--json"],
      settingsFetch() as unknown as typeof fetch,
    );
    expect(JSON.parse(out)).toEqual(CURRENT);
  });
});

describe("integration-layer project-settings set", () => {
  it("PUTs the passed fields merged onto the current values", async () => {
    const fetchImpl = settingsFetch();
    const { out, error } = await runCommand(
      SettingsSet,
      ["--currency", "EUR", "--country", "DE"],
      fetchImpl as unknown as typeof fetch,
    );

    expect(error).toBeUndefined();
    const put = fetchImpl.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(put[0]).toBe(`${BASE}/${PROJECT}/main/settings`);
    expect(JSON.parse(String(put[1]?.body))).toEqual({ ...CURRENT, currency: "EUR", country: "DE" });
    expect(out).toContain("version 3");
  });

  it("errors without any flag and does not call the API", async () => {
    const fetchImpl = settingsFetch();
    const { error } = await runCommand(SettingsSet, [], fetchImpl as unknown as typeof fetch);
    expect(error?.message).toMatch(/Nothing to update/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an empty value", async () => {
    const fetchImpl = settingsFetch();
    const { error } = await runCommand(
      SettingsSet,
      ["--label", "  "],
      fetchImpl as unknown as typeof fetch,
    );
    expect(error?.message).toMatch(/--label must not be empty/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces a rejected save", async () => {
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Response("country is required", { status: 400 })
        : new Response(JSON.stringify(GET_BODY), { status: 200 }),
    );
    const { error } = await runCommand(
      SettingsSet,
      ["--label", "X"],
      fetchImpl as unknown as typeof fetch,
    );
    expect(error?.message).toMatch(/400.*country is required/);
  });
});
