import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureOutput } from "@oclif/test";
import { describe, expect, it } from "vitest";
import ExtensionBuild from "../../../../src/commands/integration-layer/extension/build.js";

describe("integration-layer extension build", () => {
  it("bundles the entry into a single CJS artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-cli-build-"));
    await mkdir(join(dir, "src"), { recursive: true });
    const entry = join(dir, "src", "extension.ts");
    const out = join(dir, "dist", "extension.js");
    await writeFile(
      entry,
      `export const typeDefs = "type Query { ping: String }";
       export const resolvers = { Query: { ping: () => "pong" } };`,
      "utf8",
    );

    const { stdout } = await captureOutput(
      async () => ExtensionBuild.run(["--entry", entry, "--out", out]),
      { print: false },
    );

    expect(stdout).toContain("bundled");
    const bundle = await readFile(out, "utf8");
    expect(bundle).toContain("module.exports");
  });
});
