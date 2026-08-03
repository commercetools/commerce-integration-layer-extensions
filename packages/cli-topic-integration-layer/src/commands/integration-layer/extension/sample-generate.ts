import { writeFile } from "node:fs/promises";
import { Command, Flags } from "@oclif/core";
import {
  EXTENSION_RESOURCE_TYPE_IDS,
  generateExtensionInputSample,
} from "../../../lib/tooling/generateExtensionInputSample.js";

export default class ExtensionSampleGenerate extends Command {
  static override description =
    "Write a realistic commercetools ExtensionInput JSON sample for a resource type and action";

  static override examples = [
    "<%= config.bin %> integration-layer extension sample-generate --resource-type cart --action Create",
    "<%= config.bin %> integration-layer extension sample-generate --resource-type order --action Update --out ./payloads/order-update.json",
  ];

  static override flags = {
    action: Flags.string({
      description: "the trigger action the sample ExtensionInput carries",
      options: ["Create", "Update"],
      default: "Create",
    }),
    "resource-type": Flags.string({
      description: `commercetools resource type (${EXTENSION_RESOURCE_TYPE_IDS.join(", ")})`,
      required: true,
    }),
    id: Flags.string({
      description: "override the sample resource id (default: sample-<resource-type>-id)",
    }),
    out: Flags.string({
      description: "write the JSON to this file (default: print to stdout)",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionSampleGenerate);

    let sample;
    try {
      sample = generateExtensionInputSample({
        action: flags.action as "Create" | "Update",
        resourceTypeId: flags["resource-type"],
        id: flags.id,
      });
    } catch (err) {
      this.error((err as Error).message);
    }

    const json = `${JSON.stringify(sample, null, 2)}\n`;
    if (flags.out) {
      await writeFile(flags.out, json, "utf8");
      this.log(`✓ wrote ${flags.out}`);
      return;
    }
    process.stdout.write(json);
  }
}
