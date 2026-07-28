import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureOutput } from "@oclif/test";
import { describe, expect, it } from "vitest";
import Init from "../../../src/commands/integration-layer/init.js";

describe("integration-layer init", () => {
  it("scaffolds a monorepo with a hello-world extension extending Query", async () => {
    const parent = await mkdtemp(join(tmpdir(), "il-cli-init-"));
    const dir = join(parent, "my-extensions");

    const { error } = await captureOutput(async () => Init.run([dir]), { print: false });
    expect(error).toBeUndefined();

    const workspace = await readFile(join(dir, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).toContain("extensions/*");

    const rootPkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(rootPkg.name).toBe("my-extensions");
    expect(rootPkg.private).toBe(true);

    // The whole-project scripts operate on the ONE combined bundle (not `pnpm -r`).
    expect(rootPkg.scripts.dev).toBe("commercetools integration-layer extension serve --all");
    expect(rootPkg.scripts.build).toBe("commercetools integration-layer extension build --all");
    expect(rootPkg.scripts.validate).toBe("commercetools integration-layer extension validate --all");
    expect(rootPkg.scripts.push).toBe("commercetools integration-layer extension push --all");

    const extPkg = JSON.parse(
      await readFile(join(dir, "extensions", "hello-world", "package.json"), "utf8"),
    );
    expect(extPkg.name).toBe("@extensions/hello-world");
    // A single package can be served standalone, but validate/push are whole-project
    // (one bundle) — so they live only at the root, never per package.
    expect(extPkg.scripts.dev).toBe("commercetools integration-layer extension serve");
    expect(extPkg.scripts.validate).toBeUndefined();
    expect(extPkg.scripts.push).toBeUndefined();

    const extension = await readFile(
      join(dir, "extensions", "hello-world", "src", "extension.ts"),
      "utf8",
    );
    expect(extension).toContain("type Query");
    expect(extension).toContain("hello(name: String): String!");
    expect(extension).toContain("{ name }: { name?: string }");
    expect(extension).toContain("ctx: ExtensionContext");
    expect(extension).toContain("ctx.config.GREETING");
    expect(extension).toContain("export const resolvers");

    const readme = await readFile(join(dir, "README.md"), "utf8");
    expect(readme).toContain("pnpm add -g @commercetools/cli@dev");
    expect(readme).toContain("commercetools plugins install @commercetools/cli-topic-integration-layer");
    expect(readme).toContain("commercetools auth login");
  });

  it("refuses a non-empty directory without --force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-cli-init-"));
    await writeFile(join(dir, "existing.txt"), "keep me", "utf8");

    const { error } = await captureOutput(async () => Init.run([dir]), { print: false });
    expect(error?.message).toMatch(/not empty/);
  });

  it("scaffolds into a non-empty directory with --force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-cli-init-"));
    await writeFile(join(dir, "existing.txt"), "keep me", "utf8");

    await captureOutput(async () => Init.run([dir, "--force"]), { print: false });

    const entries = await readdir(dir);
    expect(entries).toContain("pnpm-workspace.yaml");
    expect(entries).toContain("existing.txt");
  });
});
