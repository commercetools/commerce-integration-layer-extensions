import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Flags } from "@oclif/core";
import { buildBundle, defaultEntry, defaultOutfile } from "../../../lib/tooling/build.js";
import { validateBundle, BundleValidationError } from "../../../lib/tooling/validateBundle.js";
import { pushBundle, remoteValidate, type RemoteValidationResult } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class ExtensionPush extends IntegrationLayerCommand {
  static override description =
    "Build + validate (local + remote) + upload the bundle, replacing the project's stored one";

  static override examples = [
    "<%= config.bin %> integration-layer extension push",
    "<%= config.bin %> integration-layer extension push --force",
  ];

  static override flags = {
    entry: Flags.string({ description: "extension entry source file", default: defaultEntry() }),
    out: Flags.string({ description: "bundle output file", default: defaultOutfile() }),
    force: Flags.boolean({
      char: "f",
      description: "upload despite a failing REMOTE validation (the local check always hard-fails)",
      default: false,
    }),
  };

  /** True when the remote result should abort the push. */
  private reportRemote(result: RemoteValidationResult): boolean {
    if (!result.composes) {
      this.logToStderr("✗ extension does not compose with the integration layer supergraph:");
      for (const err of result.compositionErrors) this.logToStderr(`  - ${err}`);
    } else if (result.breakingChanges.length > 0) {
      this.logToStderr("✗ extension introduces breaking changes to the published supergraph:");
      for (const change of result.breakingChanges) {
        this.logToStderr(`  - [${change.type}] ${change.description}`);
      }
    } else if (!result.comparedToPublished) {
      this.log(
        "✓ composes with the integration layer supergraph (breaking-change check skipped: no published baseline)",
      );
    } else {
      this.log("✓ composes with the integration layer supergraph and introduces no breaking changes");
    }
    return result.valid;
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionPush);

    // Bundle, then VALIDATE before we touch the store. Local check first — it always
    // hard-fails, regardless of --force.
    const { outfile, sourceFiles } = await buildBundle(flags.entry, flags.out);
    let typeDefs: string | null;
    try {
      const local = await validateBundle(outfile, sourceFiles);
      typeDefs = local.typeDefs;
      this.log(
        `✓ validated bundle (resolver roots: ${local.resolverTypes.join(", ") || "none"}; ` +
          `API extensions: ${local.apiExtensionKeys.join(", ") || "none"})`,
      );
    } catch (err) {
      if (err instanceof BundleValidationError) this.error(err.message);
      throw err;
    }

    const { baseUrl, projectKey, token } = await this.resolveIlContext(flags);

    // Remote check composes the GraphQL subgraph WITH the integration layer + checks
    // for breaking changes. Only applies when the bundle has a subgraph — an
    // API-extensions-only bundle has no SDL, so skip straight to the upload.
    if (typeDefs !== null) {
      const remote = await remoteValidate(baseUrl, projectKey, token, typeDefs);
      const valid = this.reportRemote(remote);
      if (!valid) {
        if (!flags.force) {
          this.error("Aborting push. Re-run with --force to override the remote validation.");
        }
        this.logToStderr("⚠ forcing push despite failing validation (--force).");
      }
    }

    const bundle = await readFile(outfile, "utf8");
    const filename = `${basename(outfile).replace(/\.[^.]+$/, "")}.cjs`;
    const url = `${baseUrl}/${encodeURIComponent(projectKey)}/extension/bundle`;
    this.log(`Pushing extension bundle (${bundle.length} bytes) → ${url}`);
    const meta = await pushBundle(baseUrl, projectKey, token, bundle, filename);
    this.log(`✓ stored revision ${meta.version} (${meta.length} bytes, filename ${meta.filename ?? filename})`);
  }
}
