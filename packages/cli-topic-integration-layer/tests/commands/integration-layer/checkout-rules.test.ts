import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import CheckoutRulesAdd from "../../../src/commands/integration-layer/checkout-rules/add.js";
import CheckoutRulesGet from "../../../src/commands/integration-layer/checkout-rules/get.js";
import CheckoutRulesRemove from "../../../src/commands/integration-layer/checkout-rules/remove.js";
import CheckoutRulesSet from "../../../src/commands/integration-layer/checkout-rules/set.js";
import { parseRules } from "../../../src/lib/checkoutRules.js";
import type { IlContext } from "../../../src/lib/base.js";

const BASE = "https://extensions.integration-layer.eu-central-1.aws.commercetools.com";
const PROJECT = "my-project";

const SETTINGS = { label: "Acme", language: "en-US", currency: "USD", country: "US" };
const RULES = [
  { countries: ["DE", "AT"], applicationKey: "eu-app", mode: "COMPLETE" },
  { stores: ["vip"], applicationKey: "vip-app", mode: "PAYMENT_ONLY" },
  { applicationKey: "default-app", mode: "PAYMENT_ONLY" },
];

async function runCommand(
  Command:
    | typeof CheckoutRulesGet
    | typeof CheckoutRulesSet
    | typeof CheckoutRulesAdd
    | typeof CheckoutRulesRemove,
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

/** GET settings carries `project.checkout` (when `rules`); PUT checkout echoes `{ checkout, version }`. */
function checkoutFetch(rules: object[] | undefined) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      return new Response(JSON.stringify({ checkout: JSON.parse(String(init.body)), version: 5 }), {
        status: 200,
      });
    }
    expect(String(url)).toBe(`${BASE}/${PROJECT}/main/settings`);
    const project = rules ? { ...SETTINGS, checkout: { rules } } : SETTINGS;
    return new Response(JSON.stringify({ project, platform: { regionId: "r" }, version: 1 }), {
      status: 200,
    });
  });
}

const asFetch = (f: ReturnType<typeof checkoutFetch>) => f as unknown as typeof fetch;
const putOf = (f: ReturnType<typeof checkoutFetch>) => f.mock.calls.find(([, i]) => i?.method === "PUT");
const putRules = (f: ReturnType<typeof checkoutFetch>) => JSON.parse(String(putOf(f)![1]?.body)).rules;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseRules", () => {
  it("accepts a bare array or { rules }, normalising countries", () => {
    const doc = [{ countries: ["de", " at "], applicationKey: " app ", mode: "COMPLETE" }];
    const expected = [{ countries: ["DE", "AT"], applicationKey: "app", mode: "COMPLETE" }];
    expect(parseRules(JSON.stringify(doc))).toEqual(expected);
    expect(parseRules(JSON.stringify({ rules: doc }))).toEqual(expected);
  });

  it.each([
    ["not json", /not valid JSON/],
    ["[]", /At least one rule/],
    ['[{"applicationKey":"","mode":"COMPLETE"}]', /Rule 1: .*Application key/],
    ['[{"applicationKey":"a"}]', /Rule 1: A rule needs a mode \(PAYMENT_ONLY or COMPLETE\)/],
    ['[{"applicationKey":"a","mode":"NOPE"}]', /Invalid mode 'NOPE'/],
    ['[{"applicationKey":"a","mode":"COMPLETE","countries":["DEU"]}]', /'DEU' is not a valid country/],
    ['[{"applicationKey":"a","mode":"COMPLETE","stores":["a b"]}]', /'a b' is not a valid store key/],
    ['[{"applicationKey":"a","mode":"COMPLETE","stores":"web"}]', /'stores' must be an array/],
  ])("rejects %s", (doc, message) => {
    expect(() => parseRules(doc)).toThrow(message);
  });
});

describe("integration-layer checkout-rules get", () => {
  it("lists the rules in match order", async () => {
    const { out } = await runCommand(CheckoutRulesGet, [], asFetch(checkoutFetch(RULES)));
    expect(out).toContain("1. countries: DE, AT | stores: any → eu-app (COMPLETE)");
    expect(out).toContain("3. countries: any | stores: any → default-app (PAYMENT_ONLY)");
  });

  it("says so, and prints empty rules as JSON, when none are configured", async () => {
    const f = checkoutFetch(undefined);
    expect((await runCommand(CheckoutRulesGet, [], asFetch(f))).out).toContain("No checkout rules");
    const { out } = await runCommand(CheckoutRulesGet, ["--json"], asFetch(f));
    expect(JSON.parse(out)).toEqual({ rules: [] });
  });
});

describe("integration-layer checkout-rules set", () => {
  const file = (content: string) => {
    const path = join(mkdtempSync(join(tmpdir(), "rules-")), "rules.json");
    writeFileSync(path, content);
    return path;
  };

  it("PUTs the file's rules to the checkout route", async () => {
    const f = checkoutFetch(RULES);
    const path = file(JSON.stringify([{ applicationKey: "only", mode: "COMPLETE" }]));
    const { error, out } = await runCommand(CheckoutRulesSet, ["--file", path, "--force"], asFetch(f));
    expect(error).toBeUndefined();
    expect(putOf(f)![0]).toBe(`${BASE}/${PROJECT}/main/checkout`);
    expect(putRules(f)).toEqual([{ applicationKey: "only", mode: "COMPLETE" }]);
    expect(out).toContain("version 5");
  });

  it("sets every per-rule field from the file: applicationKey, mode, countries, stores", async () => {
    const f = checkoutFetch(undefined);
    const rules = [
      { countries: ["DE", "AT"], stores: ["web", "app"], applicationKey: "full", mode: "COMPLETE" },
      { applicationKey: "minimal", mode: "PAYMENT_ONLY" },
    ];
    const { error } = await runCommand(CheckoutRulesSet, ["--file", file(JSON.stringify(rules)), "--force"], asFetch(f));
    expect(error).toBeUndefined();
    expect(putRules(f)).toEqual(rules);
  });

  it("rejects an invalid file without calling the API", async () => {
    const f = checkoutFetch(RULES);
    const path = file('[{"applicationKey":"a","mode":"BAD"}]');
    const { error } = await runCommand(CheckoutRulesSet, ["--file", path, "--force"], asFetch(f));
    expect(error?.message).toMatch(/Rule 1: Invalid mode/);
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses to prompt without a TTY unless --force", async () => {
    const f = checkoutFetch(RULES);
    const path = file('[{"applicationKey":"a","mode":"COMPLETE"}]');
    const { error } = await runCommand(CheckoutRulesSet, ["--file", path], asFetch(f));
    expect(error?.message).toMatch(/--force/);
    expect(putOf(f)).toBeUndefined();
  });
});

describe("integration-layer checkout-rules add", () => {
  it("appends a rule by default", async () => {
    const f = checkoutFetch(RULES);
    const { error } = await runCommand(
      CheckoutRulesAdd,
      ["--application-key", "new", "--country", "fr,es", "--store", "a", "--store", "b", "--mode", "COMPLETE"],
      asFetch(f),
    );
    expect(error).toBeUndefined();
    const rules = putRules(f);
    expect(rules).toHaveLength(4);
    expect(rules[3]).toEqual({
      countries: ["FR", "ES"],
      stores: ["a", "b"],
      applicationKey: "new",
      mode: "COMPLETE",
    });
  });

  it("accepts both modes", async () => {
    for (const mode of ["COMPLETE", "PAYMENT_ONLY"]) {
      const f = checkoutFetch(undefined);
      await runCommand(CheckoutRulesAdd, ["--application-key", "a", "--mode", mode], asFetch(f));
      expect(putRules(f)).toEqual([{ applicationKey: "a", mode }]);
    }
  });

  it("rejects a mode other than COMPLETE or PAYMENT_ONLY", async () => {
    const f = checkoutFetch(undefined);
    const { error } = await runCommand(CheckoutRulesAdd, ["--application-key", "a", "--mode", "FULL"], asFetch(f));
    expect(error).toBeDefined();
    expect(putOf(f)).toBeUndefined();
  });

  it("starts the list when none is configured, defaulting to PAYMENT_ONLY", async () => {
    const f = checkoutFetch(undefined);
    await runCommand(CheckoutRulesAdd, ["--application-key", "first"], asFetch(f));
    expect(putRules(f)).toEqual([{ applicationKey: "first", mode: "PAYMENT_ONLY" }]);
  });

  it("inserts at --position", async () => {
    const f = checkoutFetch(RULES);
    await runCommand(CheckoutRulesAdd, ["--application-key", "top", "--position", "1"], asFetch(f));
    expect(putRules(f).map((r: { applicationKey: string }) => r.applicationKey)).toEqual([
      "top", "eu-app", "vip-app", "default-app",
    ]);
  });

  it("rejects an out-of-range position and a bad country without calling the API", async () => {
    const f = checkoutFetch(RULES);
    const pos = await runCommand(CheckoutRulesAdd, ["--application-key", "x", "--position", "9"], asFetch(f));
    expect(pos.error?.message).toMatch(/out of range/);
    const bad = await runCommand(CheckoutRulesAdd, ["--application-key", "x", "--country", "DEU"], asFetch(f));
    expect(bad.error?.message).toMatch(/not a valid country/);
    expect(putOf(f)).toBeUndefined();
  });
});

describe("integration-layer checkout-rules remove", () => {
  it("removes the rule at the given position", async () => {
    const f = checkoutFetch(RULES);
    const { error } = await runCommand(CheckoutRulesRemove, ["2", "--force"], asFetch(f));
    expect(error).toBeUndefined();
    expect(putRules(f).map((r: { applicationKey: string }) => r.applicationKey)).toEqual([
      "eu-app", "default-app",
    ]);
  });

  it("errors on a missing position and on the last remaining rule", async () => {
    const many = checkoutFetch(RULES);
    expect((await runCommand(CheckoutRulesRemove, ["4", "--force"], asFetch(many))).error?.message).toMatch(
      /No rule at position 4/,
    );
    const one = checkoutFetch([RULES[0]]);
    expect((await runCommand(CheckoutRulesRemove, ["1", "--force"], asFetch(one))).error?.message).toMatch(
      /last rule/,
    );
    expect(putOf(many)).toBeUndefined();
    expect(putOf(one)).toBeUndefined();
  });
});
