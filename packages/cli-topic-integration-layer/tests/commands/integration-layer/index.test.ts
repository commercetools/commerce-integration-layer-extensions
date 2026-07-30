import { createRequire } from "node:module";
import { captureOutput } from "@oclif/test";
import { describe, expect, it } from "vitest";
import IntegrationLayer from "../../../src/commands/integration-layer/index.js";

const pkg = createRequire(import.meta.url)("../../../package.json") as {
  name: string;
  version: string;
};

describe("integration-layer --version", () => {
  it("prints the plugin name and version", async () => {
    const { stdout } = await captureOutput(
      async () => IntegrationLayer.run(["--version"]),
      { print: false },
    );

    expect(stdout).toContain(`${pkg.name}/${pkg.version}`);
  });

  it("accepts the -v alias", async () => {
    const { stdout } = await captureOutput(
      async () => IntegrationLayer.run(["-v"]),
      { print: false },
    );

    expect(stdout).toContain(`${pkg.name}/${pkg.version}`);
  });
});
