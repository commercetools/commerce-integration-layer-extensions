import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Flags } from "@oclif/core";
import { deleteExtensionSubgraph } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export default class ExtensionDelete extends IntegrationLayerCommand {
  static override description = "Remove the extension subgraph from the project's published graph";

  static override examples = [
    "<%= config.bin %> integration-layer extension delete",
    "<%= config.bin %> integration-layer extension delete --yes",
  ];

  static override flags = {
    yes: Flags.boolean({ char: "y", description: "skip the confirmation prompt", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionDelete);
    const { baseUrl, projectKey, token } = await this.resolveIlContext(flags);

    if (!flags.yes) {
      const confirmed = await confirm(
        `Remove the extension subgraph for '${projectKey}' from the published graph? (y/N)`,
      );
      if (!confirmed) {
        this.log("Aborted.");
        return;
      }
    }

    await deleteExtensionSubgraph(baseUrl, projectKey, token);
    this.log(`✓ removed the extension subgraph for '${projectKey}'.`);
  }
}
