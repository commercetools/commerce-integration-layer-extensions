import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureOutput } from "@oclif/test";
import { describe, expect, it } from "vitest";
import ExtensionInvoke from "../../../../src/commands/integration-layer/extension/invoke.js";

/** Write an extension source into a temp package; return the invoke flags addressing it. */
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

describe("integration-layer extension invoke", () => {
  it("puts --quantity on the sample cart's line item, so a cap handler modifies it", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    const { stdout } = await captureOutput(
      async () =>
        ExtensionInvoke.run([...flags, "--quantity", "25", "--config", "MAX_LINE_QUANTITY=10"]),
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
        ExtensionInvoke.run([...flags, "--quantity", "2", "--config", "MAX_LINE_QUANTITY=10"]),
      { print: false },
    );

    expect(stdout).toContain("APPROVE");
  });

  it("defaults the sample quantity to 1", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    const { stdout } = await captureOutput(
      async () => ExtensionInvoke.run([...flags, "--config", "MAX_LINE_QUANTITY=10"]),
      { print: false },
    );

    expect(stdout).toContain("x1");
    expect(stdout).toContain("APPROVE");
  });
});
