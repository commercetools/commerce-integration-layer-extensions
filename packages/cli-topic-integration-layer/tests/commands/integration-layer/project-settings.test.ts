import { afterEach, describe, expect, it, vi } from "vitest";

import SettingsGet from "../../../src/commands/integration-layer/project-settings/get.js";
import SettingsSet from "../../../src/commands/integration-layer/project-settings/set.js";
import type { IlContext } from "../../../src/lib/base.js";

const BASE = "https://extensions.integration-layer.eu-central-1.aws.commercetools.com";
const PROJECT = "my-project";

const CT_PROJECT_URL = "https://api.eu-central-1.aws.commercetools.com/my-project";
// What the commercetools project presents; the stored defaults above are a subset.
const CT_PROJECT = {
  languages: ["en-US", "de-DE"],
  countries: ["US", "DE", "AT"],
  currencies: ["USD", "EUR"],
};

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
    requirePrincipal: () => { getRegion: () => string };
    log: (...a: unknown[]) => void;
  };
  const initSpy = vi.spyOn(proto, "init").mockResolvedValue(undefined);
  const ctxSpy = vi.spyOn(proto, "resolveIlContext").mockResolvedValue(ctx);
  const principalSpy = vi.spyOn(proto, "requirePrincipal").mockReturnValue({ getRegion: () => "eu-central-1.aws" });
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
    principalSpy.mockRestore();
    logSpy.mockRestore();
  }
  return { out: out.join("\n"), error };
}

/** GET returns the current settings; PUT echoes the body back as `{ project, version }`. */
function settingsFetch() {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    if (url === CT_PROJECT_URL) return new Response(JSON.stringify(CT_PROJECT), { status: 200 });
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

  it("asks for a value the project has none stored for, instead of sending an incomplete body", async () => {
    const { country: _country, ...legacy } = CURRENT;
    const fetchImpl = vi.fn(async (u: unknown, init?: RequestInit) =>
      u === CT_PROJECT_URL
        ? new Response(JSON.stringify(CT_PROJECT), { status: 200 })
        : init?.method === "PUT"
        ? new Response(JSON.stringify({ project: JSON.parse(String(init.body)), version: 3 }), { status: 200 })
        : new Response(JSON.stringify({ ...GET_BODY, project: legacy }), { status: 200 }),
    );
    const { error } = await runCommand(
      SettingsSet,
      ["--currency", "EUR"],
      fetchImpl as unknown as typeof fetch,
    );
    expect(error?.message).toMatch(/no stored country — pass --country/);
    expect(fetchImpl.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(false);

    const ok = await runCommand(SettingsSet, ["--country", "DE"], fetchImpl as unknown as typeof fetch);
    expect(ok.error).toBeUndefined();
  });

  it("validates language, currency and country against the commercetools project", async () => {
    const fetchImpl = settingsFetch();
    const { error } = await runCommand(
      SettingsSet,
      ["--currency", "EUR", "--country", "DE", "--language", "de-DE"],
      fetchImpl as unknown as typeof fetch,
    );
    expect(error).toBeUndefined();
    expect(fetchImpl.mock.calls.some(([u]) => u === CT_PROJECT_URL)).toBe(true);
  });

  it("stores the project's own spelling of a value given in another case", async () => {
    const fetchImpl = settingsFetch();
    await runCommand(
      SettingsSet,
      ["--currency", "eur", "--country", "de", "--language", "DE-de"],
      fetchImpl as unknown as typeof fetch,
    );
    const put = fetchImpl.mock.calls.find(([, i]) => i?.method === "PUT")!;
    expect(JSON.parse(String(put[1]?.body))).toMatchObject({ currency: "EUR", country: "DE", language: "de-DE" });
  });

  it.each([
    [["--country", "Germany"], /does not present country 'Germany'. It presents: US, DE, AT\./],
    [["--currency", "GBP"], /does not present currency 'GBP'. It presents: USD, EUR\./],
    [["--language", "fr-FR"], /does not present language 'fr-FR'. It presents: en-US, de-DE\./],
  ])("rejects a value the project does not present (%j) without saving", async (argv, message) => {
    const fetchImpl = settingsFetch();
    const { error } = await runCommand(SettingsSet, argv, fetchImpl as unknown as typeof fetch);
    expect(error?.message).toMatch(message);
    expect(fetchImpl.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(false);
  });

  it("does not read the commercetools project for a label-only change", async () => {
    const fetchImpl = settingsFetch();
    const { error } = await runCommand(SettingsSet, ["--label", "New"], fetchImpl as unknown as typeof fetch);
    expect(error).toBeUndefined();
    expect(fetchImpl.mock.calls.some(([u]) => u === CT_PROJECT_URL)).toBe(false);
  });

  it("fails loudly when the commercetools project cannot be read", async () => {
    const fetchImpl = vi.fn(async (u: unknown, _init?: RequestInit) =>
      u === CT_PROJECT_URL ? new Response("forbidden", { status: 403 }) : new Response(JSON.stringify(GET_BODY), { status: 200 }),
    );
    const { error } = await runCommand(SettingsSet, ["--country", "DE"], fetchImpl as unknown as typeof fetch);
    expect(error?.message).toMatch(/403.*forbidden/);
    expect(fetchImpl.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(false);
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
