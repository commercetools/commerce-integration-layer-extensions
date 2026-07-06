// Integration test for the build + validate pipeline: runs the real esbuild build on
// fixture sources and feeds the output to the real validateBundle (no mocks), proving
// good bundles pass (and `graphql` stays external) and every class of broken bundle is
// rejected. The shipped templates are exercised separately in examples.test.ts.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GraphQLError } from "graphql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBundle, type BuildResult } from "../src/build.js";
import { loadBundleSource } from "../src/loadBundle.js";
import { analyzeSources } from "../src/staticAnalysis.js";
import { BundleValidationError, validateBundle } from "../src/validateBundle.js";

const here = dirname(fileURLToPath(import.meta.url));
const toolingRoot = join(here, "..");
const fixtures = join(here, "fixtures");

let tmpDir: string;
beforeAll(async () => {
  tmpDir = await mkdtemp(join(toolingRoot, ".tmp-ee-test-"));
});
afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Bundle a fixture's `extension.ts` to a unique `.cjs` file; returns the build result. */
async function buildFixture(name: string): Promise<BuildResult> {
  const outfile = join(tmpDir, `${name}.cjs`);
  return buildBundle(join(fixtures, name, "extension.ts"), outfile);
}

describe("an extension that attaches a field to an integration-layer entity (@interfaceObject)", () => {
  it("passes the local checks (composition is the remote check's job, not run here)", async () => {
    const { outfile, sourceFiles } = await buildFixture("interface-object");
    const result = await validateBundle(outfile, sourceFiles);
    // The resolver lives on the existing `Product` entity, not a new root type.
    expect(result.resolverTypes).toEqual(["Product"]);
    expect(result.typeDefs).toContain("@interfaceObject");
  });
});

describe("a valid bundle that imports a local helper", () => {
  it("passes validation", async () => {
    const { outfile, sourceFiles } = await buildFixture("valid");
    const result = await validateBundle(outfile, sourceFiles);
    expect(result.resolverTypes).toEqual(["Query"]);
  });

  it("inlines the helper into the single-file bundle (no dangling import)", async () => {
    const { outfile } = await buildFixture("valid");
    const code = await readFile(outfile, "utf8");
    expect(code).toContain("hello from an inlined helper module");
    expect(code).not.toMatch(/from\s*["']\.\/greeting/);
  });

  it("loads and runs: the resolver returns the inlined helper's value", async () => {
    const { outfile } = await buildFixture("valid");
    const mod = loadBundleSource(await readFile(outfile, "utf8")) as {
      resolvers: { Query: { greeting: () => string } };
    };
    expect(mod.resolvers.Query.greeting()).toBe("hello from an inlined helper module");
  });
});

describe("a valid bundle that imports the host-provided `graphql`", () => {
  it("passes validation but keeps graphql external (not inlined)", async () => {
    const { outfile, sourceFiles } = await buildFixture("external-import");
    const result = await validateBundle(outfile, sourceFiles);
    expect(result.resolverTypes).toEqual(["Query"]);

    const code = await readFile(outfile, "utf8");
    // CJS output: graphql is pulled via require(), not bundled in.
    expect(code).toMatch(/require\(["']graphql["']\)/);
    // A telltale of graphql-js having been inlined would be its own source; the
    // bundle should carry only the bare require, not the library.
    expect(code).not.toContain("class GraphQLSchema");
  });

  it("loads and runs: throws the host's GraphQLError across the boundary", async () => {
    const { outfile } = await buildFixture("external-import");
    const mod = loadBundleSource(await readFile(outfile, "utf8")) as {
      resolvers: { Query: { boom: () => never } };
    };
    // The require("graphql") shim hands the bundle the HOST's graphql instance,
    // so the error it throws is recognised as a host GraphQLError (its
    // `instanceof`/`extensions` survive into a GraphQL response).
    expect(() => mod.resolvers.Query.boom()).toThrow(GraphQLError);
    expect(() => mod.resolvers.Query.boom()).toThrow("kaboom");
  });
});

describe("validation rejects broken bundles", () => {
  it("when `resolvers` is missing", async () => {
    const { outfile, sourceFiles } = await buildFixture("missing-resolvers");
    await expect(validateBundle(outfile, sourceFiles)).rejects.toThrow(BundleValidationError);
    await expect(validateBundle(outfile, sourceFiles)).rejects.toThrow(/resolvers/);
  });

  it("when `typeDefs` is not parseable SDL", async () => {
    const { outfile, sourceFiles } = await buildFixture("bad-sdl");
    await expect(validateBundle(outfile, sourceFiles)).rejects.toThrow(/not valid GraphQL SDL/);
  });

  it("when the SDL references a type it never declares", async () => {
    const { outfile, sourceFiles } = await buildFixture("non-composable");
    await expect(validateBundle(outfile, sourceFiles)).rejects.toThrow(
      /does not build into a valid schema/,
    );
  });

  it("when a resolver names a field the SDL does not declare", async () => {
    const { outfile, sourceFiles } = await buildFixture("resolver-typo");
    await expect(validateBundle(outfile, sourceFiles)).rejects.toThrow(
      /resolver `Query\.greetng` has no matching field/,
    );
  });

  it("when the source reaches for ambient authority (a runtime-incompatible pattern)", async () => {
    // Composes fine, but reads `process.env` — which does not exist at runtime.
    // The static analyzer flags it from the source, so it fails here rather than
    // when the extension is loaded live.
    const { outfile, sourceFiles } = await buildFixture("ambient-authority");
    await expect(validateBundle(outfile, sourceFiles)).rejects.toThrow(BundleValidationError);
    await expect(validateBundle(outfile, sourceFiles)).rejects.toThrow(/process/);
  });
});

describe("static analysis of non-endowed globals", () => {
  // analyzeSources reads files, so write throwaway sources to the temp dir.
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
