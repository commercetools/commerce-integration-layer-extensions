import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import FieldVisibilityHide from "../../../src/commands/integration-layer/field-visibility/hide.js";
import FieldVisibilityList from "../../../src/commands/integration-layer/field-visibility/list.js";
import FieldVisibilitySet from "../../../src/commands/integration-layer/field-visibility/set.js";
import FieldVisibilityShow from "../../../src/commands/integration-layer/field-visibility/show.js";
import { parseCoordinates } from "../../../src/lib/fieldVisibility.js";
import type { IlContext } from "../../../src/lib/base.js";

const BASE = "https://extensions.integration-layer.eu-central-1.aws.commercetools.com";
const PROJECT = "my-project";

const coord = (fieldName: string, typeKey = "internal-ops", space = "customField") => ({
  space,
  typeKey,
  fieldName,
});

// costPrice: hidden and in force. marginBand: visible. ghost: a rule for a field that
// does not exist. internalCode: a hidden product attribute.
const ROWS = [
  { coordinate: coord("costPrice"), fieldType: "Money", active: true },
  { coordinate: coord("marginBand"), fieldType: "String", active: false },
  { coordinate: coord("ghost"), active: false, reason: "noSuchField" },
  { coordinate: coord("internalCode", "shoes", "attribute"), fieldType: "text", active: true },
];

async function runCommand(
  Command:
    | typeof FieldVisibilityList
    | typeof FieldVisibilityHide
    | typeof FieldVisibilityShow
    | typeof FieldVisibilitySet,
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

function visibilityFetch(publishPending = false) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    expect(String(url)).toBe(`${BASE}/${PROJECT}/main/schema/visibility`);
    if (init?.method === "PUT") {
      return new Response(
        JSON.stringify({ hiddenFields: JSON.parse(String(init.body)), version: 8, publishPending }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ fields: ROWS, version: 7 }), { status: 200 });
  });
}

const asFetch = (f: ReturnType<typeof visibilityFetch>) => f as unknown as typeof fetch;
const putOf = (f: ReturnType<typeof visibilityFetch>) => f.mock.calls.find(([, i]) => i?.method === "PUT");
const putBody = (f: ReturnType<typeof visibilityFetch>) => JSON.parse(String(putOf(f)![1]?.body));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseCoordinates", () => {
  it("accepts a bare array or { hiddenFields } and drops duplicates", () => {
    const doc = [coord("a"), coord("a"), coord("b")];
    expect(parseCoordinates(JSON.stringify(doc))).toEqual([coord("a"), coord("b")]);
    expect(parseCoordinates(JSON.stringify({ hiddenFields: [coord("a")] }))).toEqual([coord("a")]);
    expect(parseCoordinates("[]")).toEqual([]);
  });

  it("accepts the limits exactly: 256-character identifiers and 500 rules", () => {
    const edge = { ...coord("f".repeat(256)), typeKey: "k".repeat(256) };
    expect(parseCoordinates(JSON.stringify([edge]))).toEqual([edge]);
    const many = Array.from({ length: 500 }, (_, i) => coord(`f${i}`));
    expect(parseCoordinates(JSON.stringify(many))).toHaveLength(500);
  });

  it.each([
    ["nope", /not valid JSON/],
    ['{"x":1}', /Expected a JSON array/],
    ['[{"space":"customField","typeKey":"t"}]', /Rule 1: 'fieldName'/],
    ['[{"space":"","typeKey":"t","fieldName":"f"}]', /Rule 1: 'space'/],
    [JSON.stringify([{ ...coord("f"), typeKey: "k".repeat(257) }]), /longer than 256 characters/],
    [JSON.stringify([{ ...coord("f"), fieldName: "f".repeat(257) }]), /longer than 256 characters/],
    [
      JSON.stringify(Array.from({ length: 501 }, (_, i) => coord(`f${i}`))),
      /At most 500 hidden fields are supported \(got 501\)/,
    ],
    ['[{"space":"column","typeKey":"t","fieldName":"f"}]', /'space' must be customField or attribute, not 'column'/],
  ])("rejects %s", (doc, message) => {
    expect(() => parseCoordinates(doc)).toThrow(message);
  });
});

describe("integration-layer field-visibility list", () => {
  it("groups fields by type and marks hidden ones and rules not in force", async () => {
    const { out } = await runCommand(FieldVisibilityList, [], asFetch(visibilityFetch()));
    expect(out).toContain("3 rule(s)");
    expect(out).toContain("internal-ops (customField)");
    expect(out).toContain("[hidden ] costPrice : Money");
    expect(out).toContain("[visible] marginBand : String");
    expect(out).toContain("ghost  — rule not in force: the field does not exist on that type");
    expect(out).toContain("shoes (attribute)");
  });

  it("--hidden filters to fields a rule names", async () => {
    const { out } = await runCommand(FieldVisibilityList, ["--hidden"], asFetch(visibilityFetch()));
    expect(out).not.toContain("marginBand");
    expect(out).toContain("costPrice");
  });
});

describe("integration-layer field-visibility hide", () => {
  it("adds the fields to the stored rules, keeping the existing ones", async () => {
    const f = visibilityFetch();
    const { error, out } = await runCommand(
      FieldVisibilityHide,
      ["--type-key", "internal-ops", "marginBand"],
      asFetch(f),
    );
    expect(error).toBeUndefined();
    expect(putBody(f)).toEqual([
      coord("costPrice"),
      coord("ghost"),
      coord("internalCode", "shoes", "attribute"),
      coord("marginBand"),
    ]);
    expect(out).toContain("version 8");
  });

  it("stores a rule for a field that does not exist yet, with a note", async () => {
    const f = visibilityFetch();
    const { out } = await runCommand(FieldVisibilityHide, ["--type-key", "internal-ops", "future"], asFetch(f));
    expect(out).toContain("has no field 'future' yet");
    expect(putBody(f)).toContainEqual(coord("future"));
  });

  it("supports the attribute space", async () => {
    const f = visibilityFetch();
    await runCommand(FieldVisibilityHide, ["--space", "attribute", "--type-key", "shoes", "sku"], asFetch(f));
    expect(putBody(f)).toContainEqual(coord("sku", "shoes", "attribute"));
  });

  it("rejects an over-long identifier or too many rules without calling the API", async () => {
    const long = visibilityFetch();
    const a = await runCommand(FieldVisibilityHide, ["--type-key", "internal-ops", "f".repeat(257)], asFetch(long));
    expect(a.error?.message).toMatch(/longer than 256 characters/);
    expect(putOf(long)).toBeUndefined();

    // 3 stored rules + 498 new ones = 501.
    const full = visibilityFetch();
    const names = Array.from({ length: 498 }, (_, i) => `n${i}`);
    const b = await runCommand(FieldVisibilityHide, ["--type-key", "internal-ops", ...names], asFetch(full));
    expect(b.error?.message).toMatch(/At most 500 hidden fields/);
    expect(putOf(full)).toBeUndefined();
  });

  it("does not PUT when everything is already hidden", async () => {
    const f = visibilityFetch();
    const { out } = await runCommand(FieldVisibilityHide, ["--type-key", "internal-ops", "costPrice"], asFetch(f));
    expect(out).toContain("already hidden");
    expect(putOf(f)).toBeUndefined();
  });

  it("confirms the republish on success", async () => {
    const { out } = await runCommand(
      FieldVisibilityHide,
      ["--type-key", "internal-ops", "marginBand"],
      asFetch(visibilityFetch()),
    );
    expect(out).toContain("The schema was republished.");
  });

  it("fails with exit code 2 when the rules are saved but the republish failed", async () => {
    const f = visibilityFetch(true);
    const { out, error } = await runCommand(
      FieldVisibilityHide,
      ["--type-key", "internal-ops", "marginBand"],
      asFetch(f),
    );
    expect(putOf(f)).toBeDefined();
    expect(out).toContain("hid 1 field(s)");
    expect(error?.message).toMatch(/republishing the schema failed/);
    expect((error as { oclif?: { exit?: number } }).oclif?.exit).toBe(2);
  });
});

describe("integration-layer field-visibility show", () => {
  it("removes only the named rule", async () => {
    const f = visibilityFetch();
    const { error } = await runCommand(
      FieldVisibilityShow,
      ["--type-key", "internal-ops", "costPrice", "--force"],
      asFetch(f),
    );
    expect(error).toBeUndefined();
    expect(putBody(f)).toEqual([coord("ghost"), coord("internalCode", "shoes", "attribute")]);
  });

  it("can drop a rule whose field no longer exists", async () => {
    const f = visibilityFetch();
    await runCommand(FieldVisibilityShow, ["--type-key", "internal-ops", "ghost", "--force"], asFetch(f));
    expect(putBody(f)).not.toContainEqual(coord("ghost"));
  });

  it("does nothing for a field that is not hidden", async () => {
    const f = visibilityFetch();
    const { out } = await runCommand(
      FieldVisibilityShow,
      ["--type-key", "internal-ops", "marginBand", "--force"],
      asFetch(f),
    );
    expect(out).toContain("Nothing to show");
    expect(putOf(f)).toBeUndefined();
  });

  it("refuses to prompt without a TTY unless --force", async () => {
    const f = visibilityFetch();
    const { error } = await runCommand(FieldVisibilityShow, ["--type-key", "internal-ops", "costPrice"], asFetch(f));
    expect(error?.message).toMatch(/--force/);
    expect(putOf(f)).toBeUndefined();
  });
});

describe("integration-layer field-visibility set", () => {
  const file = (content: string) => {
    const path = join(mkdtempSync(join(tmpdir(), "vis-")), "hidden.json");
    writeFileSync(path, content);
    return path;
  };

  it("replaces the whole rule set from the file", async () => {
    const f = visibilityFetch();
    const { error } = await runCommand(
      FieldVisibilitySet,
      ["--file", file(JSON.stringify([coord("marginBand")])), "--force"],
      asFetch(f),
    );
    expect(error).toBeUndefined();
    expect(putBody(f)).toEqual([coord("marginBand")]);
  });

  it("accepts an empty list to show everything", async () => {
    const f = visibilityFetch();
    await runCommand(FieldVisibilitySet, ["--file", file("[]"), "--force"], asFetch(f));
    expect(putBody(f)).toEqual([]);
  });

  it("confirms the republish, and fails when it did not go through", async () => {
    const ok = await runCommand(FieldVisibilitySet, ["--file", file("[]"), "--force"], asFetch(visibilityFetch()));
    expect(ok.out).toContain("The schema was republished.");
    const pending = await runCommand(FieldVisibilitySet, ["--file", file("[]"), "--force"], asFetch(visibilityFetch(true)));
    expect(pending.error?.message).toMatch(/republishing the schema failed/);
  });

  it("rejects a malformed file without calling the API", async () => {
    const f = visibilityFetch();
    const { error } = await runCommand(
      FieldVisibilitySet,
      ["--file", file('[{"space":"customField","typeKey":"t"}]'), "--force"],
      asFetch(f),
    );
    expect(error?.message).toMatch(/'fieldName'/);
    expect(f).not.toHaveBeenCalled();
  });
});
