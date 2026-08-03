import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExtensionResourceTypeIdValues } from "@commercetools/platform-sdk";
import { captureOutput } from "@oclif/test";
import { describe, expect, it } from "vitest";
import ExtensionCreateApiExtensionInput from "../../src/commands/integration-layer/extension/create-api-extension-input.js";
import {
  EXTENSION_RESOURCE_TYPE_IDS,
  generateExtensionInputSample,
} from "../../src/lib/tooling/generateExtensionInputSample.js";

describe("generateExtensionInputSample", () => {
  it("tracks ExtensionResourceTypeIdValues from the platform SDK", () => {
    expect([...EXTENSION_RESOURCE_TYPE_IDS].sort()).toEqual(
      Object.values(ExtensionResourceTypeIdValues).sort(),
    );
  });

  it("builds a cart Create payload with SDK enum values", () => {
    const sample = generateExtensionInputSample({ action: "Create", resourceTypeId: "cart" });
    expect(sample.action).toBe("Create");
    expect(sample.resource.typeId).toBe("cart");
    expect(sample.resource.obj.cartState).toBe("Active");
    expect(sample.resource.obj.lineItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ variant: { id: 1, sku: "SAMPLE-SKU" } })]),
    );
  });

  it("bumps version on Update", () => {
    const sample = generateExtensionInputSample({ action: "Update", resourceTypeId: "order" });
    expect(sample.resource.obj.version).toBe(2);
  });

  it("errors on an unsupported resource type", () => {
    expect(() =>
      generateExtensionInputSample({ action: "Create", resourceTypeId: "product" }),
    ).toThrow(/unsupported resource type/);
  });

  it("covers every supported resource type", () => {
    for (const resourceTypeId of EXTENSION_RESOURCE_TYPE_IDS) {
      const sample = generateExtensionInputSample({ action: "Create", resourceTypeId });
      expect(sample.resource.typeId).toBe(resourceTypeId);
      expect(sample.resource.id).toBe(`sample-${resourceTypeId}-id`);
    }
  });
});

describe("integration-layer extension create-api-extension-input", () => {
  it("prints JSON to stdout by default", async () => {
    const { stdout } = await captureOutput(
      async () =>
        ExtensionCreateApiExtensionInput.run(["--resource-type", "cart", "--action", "Create"]),
      { print: false },
    );
    const parsed = JSON.parse(stdout);
    expect(parsed.action).toBe("Create");
    expect(parsed.resource.typeId).toBe("cart");
  });

  it("writes JSON to --out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-cli-sample-gen-"));
    const out = join(dir, "cart-create.json");
    await captureOutput(
      async () =>
        ExtensionCreateApiExtensionInput.run([
          "--resource-type",
          "cart",
          "--action",
          "Create",
          "--out",
          out,
        ]),
      { print: false },
    );
    const parsed = JSON.parse(await readFile(out, "utf8"));
    expect(parsed.resource.typeId).toBe("cart");
  });

  it("errors on an unsupported resource type", async () => {
    const { error } = await captureOutput(
      async () => ExtensionCreateApiExtensionInput.run(["--resource-type", "product"]),
      { print: false },
    );
    expect(error?.message).toMatch(/unsupported resource type/);
  });
});
