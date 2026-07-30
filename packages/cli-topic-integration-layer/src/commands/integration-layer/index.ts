import { readFileSync } from "node:fs";
import { Command, Flags } from "@oclif/core";

// The plugin's own package.json — three levels up from this command file both in
// `src/` (vitest/tsx) and the compiled `dist/` tree, since `tsc` preserves the
// `commands/integration-layer/` layout under `dist/`.
const pkg = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

// The topic's index command. Its only job is to mirror the root CLI's `--version`
// at the topic level (`commercetools integration-layer --version`); with no flag it
// just shows the topic help, so `commercetools integration-layer` behaves as before.
export default class IntegrationLayer extends Command {
  static override description = "The integration-layer extensions topic";

  static override examples = ["<%= config.bin %> integration-layer --version"];

  static override flags = {
    version: Flags.boolean({
      char: "v",
      description: "print the installed integration-layer plugin version",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IntegrationLayer);

    if (flags.version) {
      this.log(`${pkg.name}/${pkg.version}`);
      return;
    }

    await this.config.runCommand("help", ["integration-layer"]);
  }
}
