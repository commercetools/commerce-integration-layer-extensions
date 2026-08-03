import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureOutput } from "@oclif/test";
import { afterEach, describe, expect, it } from "vitest";
import ExtensionInvokeApiExtension from "../../../../src/commands/integration-layer/extension/invoke-api-extension.js";

/** Write an extension source into a temp package; return the flags addressing it. */
async function bundleFlags(source: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "il-cli-invoke-"));
  await mkdir(join(dir, "src"), { recursive: true });
  const entry = join(dir, "src", "extension.ts");
  await writeFile(entry, source, "utf8");
  return ["--entry", entry, "--out", join(dir, "dist", "extension.js")];
}

/** A handler in the shape `examples/cart-quantity-cap` ships: cap, don't block. */
const QUANTITY_CAP = `
  export const apiExtensions = [
    {
      key: "quantity-cap",
      resourceTypeId: "cart",
      actions: ["Create", "Update"],
      handler: (input, ctx) => {
        const raw = ctx.config.MAX_LINE_QUANTITY;
        if (raw === undefined) return {};
        const cap = Number(raw);
        const over = input.resource.obj.lineItems.filter((li) => li.quantity > cap);
        return over.length
          ? { actions: over.map((li) => ({ action: "changeLineItemQuantity", lineItemId: li.id, quantity: cap })) }
          : {};
      },
    },
  ];
`;

describe("integration-layer extension invoke-api-extension", () => {
  it("puts --quantity on the sample cart's line item, so a cap handler modifies it", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    const { stdout } = await captureOutput(
      async () =>
        ExtensionInvokeApiExtension.run([...flags, "--quantity", "25", "--config", "MAX_LINE_QUANTITY=10"]),
      { print: false },
    );

    expect(stdout).toContain("x25"); // the sample line reports the requested quantity
    expect(stdout).toContain("MODIFY");
    expect(stdout).toContain("changeLineItemQuantity");
  });

  it("approves when the sample quantity is under the cap", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    const { stdout } = await captureOutput(
      async () =>
        ExtensionInvokeApiExtension.run([...flags, "--quantity", "2", "--config", "MAX_LINE_QUANTITY=10"]),
      { print: false },
    );

    expect(stdout).toContain("APPROVE");
  });

  it("defaults the sample quantity to 1", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    const { stdout } = await captureOutput(
      async () => ExtensionInvokeApiExtension.run([...flags, "--config", "MAX_LINE_QUANTITY=10"]),
      { print: false },
    );

    expect(stdout).toContain("x1");
    expect(stdout).toContain("APPROVE");
  });
});

/** A bundle with two handlers on different resource types. */
const MIXED = `
  export const apiExtensions = [
    { key: "cart-guard", resourceTypeId: "cart", actions: ["Create", "Update"],
      handler: () => ({ errors: [{ code: "NoCart", message: "blocked" }] }) },
    { key: "order-tagger", resourceTypeId: "order", actions: ["Create"],
      handler: (input) => ({ actions: [{ action: "setKey", key: "seen-" + input.resource.id }] }) },
  ];
`;

describe("integration-layer extension invoke-api-extension — any resource type", () => {
  it("targets a non-cart resource via --resource-type and skips handlers that don't trigger", async () => {
    const flags = await bundleFlags(MIXED);
    const { stdout } = await captureOutput(
      async () => ExtensionInvokeApiExtension.run([...flags, "--resource-type", "order"]),
      { print: false },
    );

    expect(stdout).toContain("on order");
    expect(stdout).toContain("order-tagger: MODIFY");
    expect(stdout).toContain("setKey");
    expect(stdout).toContain("cart-guard: skipped");
  });

  it("drives a handler from a supplied --input ExtensionInput file", async () => {
    const flags = await bundleFlags(MIXED);
    const dir = await mkdtemp(join(tmpdir(), "il-cli-invoke-input-"));
    const inputPath = join(dir, "order.json");
    await writeFile(
      inputPath,
      JSON.stringify({ action: "Create", resource: { typeId: "order", id: "o-42", obj: { id: "o-42" } } }),
      "utf8",
    );

    const { stdout } = await captureOutput(
      async () => ExtensionInvokeApiExtension.run([...flags, "--input", inputPath]),
      { print: false },
    );

    expect(stdout).toContain("on order");
    expect(stdout).toContain("seen-o-42"); // the handler read the id from OUR payload
  });

  it("restricts invocation to --key handlers", async () => {
    const flags = await bundleFlags(MIXED);
    const { stdout } = await captureOutput(
      async () => ExtensionInvokeApiExtension.run([...flags, "--key", "cart-guard"]),
      { print: false },
    );

    expect(stdout).toContain("Invoking 1 handler(s)");
    expect(stdout).toContain("cart-guard: BLOCK");
    expect(stdout).not.toContain("order-tagger"); // filtered out entirely, not even a skip line
  });

  it("errors when --input is not a valid ExtensionInput", async () => {
    const flags = await bundleFlags(MIXED);
    const dir = await mkdtemp(join(tmpdir(), "il-cli-invoke-bad-"));
    const inputPath = join(dir, "bad.json");
    await writeFile(inputPath, JSON.stringify({ nope: true }), "utf8");

    const { error } = await captureOutput(
      async () => ExtensionInvokeApiExtension.run([...flags, "--input", inputPath]),
      { print: false },
    );
    expect(error?.message).toMatch(/ExtensionInput/);
  });
});

describe("integration-layer extension invoke-api-extension — --all", () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it("invokes handlers merged from every extension under ./extensions/*", async () => {
    const root = await mkdtemp(join(tmpdir(), "il-cli-invoke-all-"));
    const write = async (name: string, source: string): Promise<void> => {
      await mkdir(join(root, "extensions", name, "src"), { recursive: true });
      await writeFile(join(root, "extensions", name, "src", "extension.ts"), source, "utf8");
    };
    await write(
      "guard",
      `export const apiExtensions = [
        { key: "cart-guard", resourceTypeId: "cart", actions: ["Create", "Update"],
          handler: () => ({ errors: [{ code: "NoCart", message: "blocked" }] }) },
      ];`,
    );
    await write(
      "tagger",
      `export const apiExtensions = [
        { key: "cart-tagger", resourceTypeId: "cart", actions: ["Create", "Update"],
          handler: () => ({ actions: [{ action: "setKey", key: "tagged" }] }) },
      ];`,
    );

    process.chdir(root);
    const { stdout } = await captureOutput(
      async () => ExtensionInvokeApiExtension.run(["--all", "--out", join(root, "dist", "extension.js")]),
      { print: false },
    );

    // Both extensions' cart handlers are concatenated into the one deployed bundle.
    expect(stdout).toContain("Invoking 2 handler(s)");
    expect(stdout).toContain("cart-guard: BLOCK");
    expect(stdout).toContain("cart-tagger: MODIFY");
  });
});

describe("integration-layer extension invoke-api-extension — ctx.config from the environment", () => {
  const cwd = process.cwd();
  let envDir: string | undefined;

  afterEach(async () => {
    delete process.env.EXTENSION_CONFIG_MAX_LINE_QUANTITY;
    process.chdir(cwd);
    if (envDir) await rm(envDir, { recursive: true, force: true });
    envDir = undefined;
  });

  it("reads EXTENSION_CONFIG_* from the environment when --config is omitted", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    process.env.EXTENSION_CONFIG_MAX_LINE_QUANTITY = "10";
    const { stdout } = await captureOutput(
      async () => ExtensionInvokeApiExtension.run([...flags, "--quantity", "25"]),
      { print: false },
    );
    expect(stdout).toContain("MODIFY");
  });

  it("lets an explicit --config override EXTENSION_CONFIG_* from the environment", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    process.env.EXTENSION_CONFIG_MAX_LINE_QUANTITY = "100"; // cap 100 alone would APPROVE x25
    const { stdout } = await captureOutput(
      async () =>
        ExtensionInvokeApiExtension.run([...flags, "--quantity", "25", "--config", "MAX_LINE_QUANTITY=10"]),
      { print: false },
    );
    expect(stdout).toContain("MODIFY"); // --config cap 10 wins → x25 is over
  });

  it("auto-loads a .env from the cwd (no --config)", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    envDir = await mkdtemp(join(tmpdir(), "il-cli-invoke-env-"));
    await writeFile(join(envDir, ".env"), "EXTENSION_CONFIG_MAX_LINE_QUANTITY=10\n", "utf8");
    process.chdir(envDir);
    const { stdout } = await captureOutput(
      async () => ExtensionInvokeApiExtension.run([...flags, "--quantity", "25"]),
      { print: false },
    );
    expect(stdout).toContain("MODIFY");
  });
});
