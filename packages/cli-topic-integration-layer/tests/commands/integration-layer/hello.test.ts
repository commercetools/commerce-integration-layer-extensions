import { captureOutput } from "@oclif/test";
import { describe, expect, it } from "vitest";
import IntegrationLayerHelloCommand from "../../../src/commands/integration-layer/hello.js";

describe("integration-layer hello", () => {
  it("prints the hello world message", async () => {
    const { stdout } = await captureOutput(
      async () => IntegrationLayerHelloCommand.run([]),
      { print: false },
    );

    expect(stdout).toContain("Hello, world!");
  });
});
