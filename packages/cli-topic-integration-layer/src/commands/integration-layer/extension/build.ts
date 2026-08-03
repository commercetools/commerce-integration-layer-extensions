import { Command, Flags } from "@oclif/core";
import { defaultEntry, defaultOutfile } from "../../../lib/tooling/build.js";
import { bundleForFlags } from "../../../lib/tooling/extensions.js";

export default class ExtensionBuild extends Command {
  static override description =
    "Bundle src/extension.ts into a single self-contained CommonJS artifact";

  static override examples = [
    "<%= config.bin %> integration-layer extension build",
    "<%= config.bin %> integration-layer extension build --entry src/extension.ts --out dist/extension.js",
    "<%= config.bin %> integration-layer extension build --all",
  ];

  static override flags = {
    entry: Flags.string({
      description:
        "extension entry source file (with --all: the per-package source segment applied under each ./extensions/*)",
      default: defaultEntry(),
    }),
    out: Flags.string({ description: "bundle output file", default: defaultOutfile() }),
    all: Flags.boolean({
      description:
        "merge every extension under ./extensions/* into ONE combined bundle (the single artifact a project deploys)",
      default: false,
    }),
    "extensions-dir": Flags.string({
      description: "directory holding the extension packages (used with --all)",
      default: "extensions",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionBuild);
    let built;
    try {
      built = await bundleForFlags({
        all: flags.all,
        extensionsDir: flags["extensions-dir"],
        entry: flags.entry,
        out: flags.out,
      });
    } catch (err) {
      this.error((err as Error).message);
    }
    this.log(`✓ bundled ${built.describe} → ${built.outfile}`);
  }
}
