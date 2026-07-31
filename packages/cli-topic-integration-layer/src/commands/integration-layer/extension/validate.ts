import { Flags } from "@oclif/core";
import { defaultEntry, defaultOutfile } from "../../../lib/tooling/build.js";
import { bundleForFlags } from "../../../lib/tooling/extensions.js";
import { validateBundle, BundleValidationError } from "../../../lib/tooling/validateBundle.js";
import { remoteValidate, type RemoteValidationResult } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class ExtensionValidate extends IntegrationLayerCommand {
  static override description =
    "Build, run local checks, then compose against the project schema and gate breaking changes";

  static override examples = [
    "<%= config.bin %> integration-layer extension validate",
    "<%= config.bin %> integration-layer extension validate --skip remote",
    "<%= config.bin %> integration-layer extension validate --all",
  ];

  static override flags = {
    entry: Flags.string({ description: "extension entry source file", default: defaultEntry() }),
    out: Flags.string({ description: "bundle output file", default: defaultOutfile() }),
    all: Flags.boolean({
      description:
        "validate every extension under ./extensions/* merged into ONE combined bundle (the single deployed artifact)",
      default: false,
    }),
    "extensions-dir": Flags.string({
      description: "directory holding the extension packages (used with --all)",
      default: "extensions",
    }),
    skip: Flags.string({
      description: "run only one half of the gate",
      options: ["local", "remote"],
    }),
  };

  /** Print a remote validation result legibly. Returns true when it passed. */
  private reportRemote(result: RemoteValidationResult): boolean {
    if (!result.composes) {
      this.logToStderr("✗ extension does not compose with the Commerce Integration Layer supergraph:");
      for (const err of result.compositionErrors) this.logToStderr(`  - ${err}`);
      return false;
    }
    if (result.breakingChanges.length > 0) {
      this.logToStderr("✗ extension introduces breaking changes to the published supergraph:");
      for (const change of result.breakingChanges) {
        this.logToStderr(`  - [${change.type}] ${change.description}`);
      }
      return false;
    }
    if (!result.comparedToPublished) {
      this.log(
        "✓ composes with the Commerce Integration Layer supergraph (breaking-change check skipped: no published baseline)",
      );
      return true;
    }
    this.log("✓ composes with the Commerce Integration Layer supergraph and introduces no breaking changes");
    return true;
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionValidate);
    let outfile: string;
    let sourceFiles: string[];
    try {
      ({ outfile, sourceFiles } = await bundleForFlags({
        all: flags.all,
        extensionsDir: flags["extensions-dir"],
        entry: flags.entry,
        out: flags.out,
      }));
    } catch (err) {
      this.error((err as Error).message);
    }

    let typeDefs: string | null = null;
    if (flags.skip !== "local") {
      try {
        const local = await validateBundle(outfile, sourceFiles);
        typeDefs = local.typeDefs;
        this.log(
          `✓ local checks passed (resolver roots: ${local.resolverTypes.join(", ") || "none"}; ` +
            `API extensions: ${local.apiExtensionKeys.join(", ") || "none"})`,
        );
      } catch (err) {
        if (err instanceof BundleValidationError) this.error(err.message);
        throw err;
      }
    } else {
      // Skipping local: still need the SDL for the remote check — load it cheaply.
      const local = await validateBundle(outfile, sourceFiles).catch(() => null);
      typeDefs = local?.typeDefs ?? null;
    }

    if (flags.skip === "remote") return;
    if (typeDefs === null) {
      this.log("· no GraphQL subgraph in this bundle — nothing to compose remotely.");
      return;
    }

    const { baseUrl, projectKey, token } = await this.resolveIlContext(flags);
    const result = await remoteValidate(baseUrl, projectKey, token, typeDefs);
    if (!this.reportRemote(result)) this.error("remote validation failed.");
  }
}
