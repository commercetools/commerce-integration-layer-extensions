import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadBundleSource } from "../../src/lib/tooling/loadBundle.js";
import { composeWithIntegrationLayer } from "../../src/lib/tooling/compose.js";
import { analyzeSources } from "../../src/lib/tooling/staticAnalysis.js";

describe("loadBundleSource", () => {
  it("evaluates a CJS bundle and returns its exports", () => {
    const mod = loadBundleSource(
      `module.exports.typeDefs = "type Query { ping: String }";
       module.exports.resolvers = { Query: { ping: () => "pong" } };`,
    );
    expect(mod.typeDefs).toContain("ping");
    expect(typeof (mod.resolvers as { Query: { ping: () => string } }).Query.ping).toBe("function");
  });

  it("refuses to require anything but graphql", () => {
    expect(() => loadBundleSource(`require("node:fs");`)).toThrow(/may not require/);
  });
});

describe("composeWithIntegrationLayer", () => {
  it("returns errors (never throws) for invalid SDL", () => {
    const result = composeWithIntegrationLayer("type Query {", "type Query { a: String }", {
      integrationLayerUrl: "http://il/graphql",
      extensionUrl: "http://ext/graphql",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/not valid GraphQL/);
  });
});

describe("static analysis of non-endowed globals", () => {
  // analyzeSources reads files, so write throwaway sources to a temp dir.
  let tmpDir: string;
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ilc-static-analysis-"));
  });
  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const write = async (name: string, src: string): Promise<string> => {
    const p = join(tmpDir, name);
    await writeFile(p, src, "utf8");
    return p;
  };

  it("flags a global the sandbox deliberately withholds", async () => {
    const p = await write("withheld.ts", `export const x = new SharedArrayBuffer(8);\n`);
    const issues = await analyzeSources([p]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/SharedArrayBuffer/);
    expect(issues[0].message).toMatch(/does not provide/);
  });

  it("flags the ambient global `process`", async () => {
    const p = await write("ambient.ts", `export const secret = process.env.SOME_SECRET;\n`);
    const issues = await analyzeSources([p]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/process/);
  });

  it("does NOT flag an endowed global", async () => {
    const p = await write("endowed.ts", `export const q = new URLSearchParams("a=1").toString();\n`);
    expect(await analyzeSources([p])).toEqual([]);
  });

  it("does NOT flag a withheld name at its declaration site (only free reads are a lint)", async () => {
    // A syntactic lint has no scope resolution — a *use* of a local shadowing a
    // withheld name would still be flagged (accepted, like the `process` check) —
    // but the declaration name itself is not the ambient global, so it isn't.
    const p = await write("decl.ts", `export const performance = 1;\n`);
    expect(await analyzeSources([p])).toEqual([]);
  });
});
