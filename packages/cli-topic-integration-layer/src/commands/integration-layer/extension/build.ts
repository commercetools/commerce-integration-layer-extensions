import { Command, Flags } from "@oclif/core";
import { buildBundle, defaultEntry, defaultOutfile } from "../../../lib/tooling/build.js";

export default class ExtensionBuild extends Command {
  static override description =
    "Bundle src/extension.ts into a single self-contained CommonJS artifact";

  static override examples = [
    "<%= config.bin %> integration-layer extension build",
    "<%= config.bin %> integration-layer extension build --entry src/extension.ts --out dist/extension.js",
  ];

  static override flags = {
    entry: Flags.string({ description: "extension entry source file", default: defaultEntry() }),
    out: Flags.string({ description: "bundle output file", default: defaultOutfile() }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionBuild);
    const { outfile } = await buildBundle(flags.entry, flags.out);
    this.log(`✓ bundled ${flags.entry} → ${outfile}`);
  }
}
