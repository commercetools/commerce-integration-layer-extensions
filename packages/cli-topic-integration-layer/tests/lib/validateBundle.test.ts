// What counts as a CONTRIBUTION — i.e. which bundle shapes validate at all.
//
// `validateBundle` reads the built artifact from disk, so each case writes a throwaway
// CJS bundle to a temp dir. `sourceFiles` is empty on purpose: static analysis of the
// author's source is a separate concern (tooling.test.ts covers it), and passing no
// sources keeps these cases about shape alone.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BundleValidationError,
  validateBundle,
} from "../../src/lib/tooling/validateBundle.js";

describe("validateBundle contribution check", () => {
  let tmpDir: string;
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ilc-validate-bundle-"));
  });
  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Write `src` as a bundle file and validate it. */
  const validate = async (name: string, src: string) => {
    const file = join(tmpDir, `${name}.js`);
    await writeFile(file, src, "utf8");
    return validateBundle(file, []);
  };

  it("rejects a bundle that contributes nothing", async () => {
    await expect(validate("empty", "module.exports = {};")).rejects.toThrow(
      BundleValidationError,
    );
  });

  it("accepts a subgraph bundle and reports its resolver roots", async () => {
    const result = await validate(
      "subgraph",
      `module.exports.typeDefs = "type Query { ping: String }";
       module.exports.resolvers = { Query: { ping: () => "pong" } };`,
    );
    expect(result.typeDefs).toContain("ping");
    expect(result.resolverTypes).toEqual(["Query"]);
    expect(result.apiExtensionKeys).toEqual([]);
  });

  it("accepts an API-extensions-only bundle (no SDL to compose)", async () => {
    const result = await validate(
      "api-extensions-only",
      `module.exports.apiExtensions = [
         { key: "cart-check", resourceTypeId: "cart", actions: ["Create"], handler: () => ({}) },
       ];`,
    );
    expect(result.typeDefs).toBeNull();
    expect(result.apiExtensionKeys).toEqual(["cart-check"]);
  });

  // The regression this file exists for: a bundle whose only contribution is dispatched
  // by the runtime rather than through the schema used to be rejected for exporting no
  // `typeDefs`, even though it is a complete, deployable bundle.
  it("accepts a bundle whose only contribution is dispatched by the runtime", async () => {
    const result = await validate(
      "dispatch-only",
      `module.exports.hooks = { onEvent: () => ({}) };`,
    );
    expect(result.typeDefs).toBeNull();
    expect(result.resolverTypes).toEqual([]);
    expect(result.apiExtensionKeys).toEqual([]);
  });

  it("still rejects an empty dispatch map", async () => {
    await expect(validate("dispatch-empty", "module.exports.hooks = {};")).rejects.toThrow(
      BundleValidationError,
    );
  });
});
