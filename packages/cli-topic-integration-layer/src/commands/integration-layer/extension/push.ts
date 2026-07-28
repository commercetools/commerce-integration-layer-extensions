import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Flags } from "@oclif/core";
import { defaultEntry, defaultOutfile } from "../../../lib/tooling/build.js";
import { bundleForFlags } from "../../../lib/tooling/extensions.js";
import { validateBundle, BundleValidationError } from "../../../lib/tooling/validateBundle.js";
import { pushBundle, remoteValidate, type RemoteValidationResult } from "../../../lib/ilClient.js";
import { resolveSourceRevision } from "../../../lib/sourceRevision.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class ExtensionPush extends IntegrationLayerCommand {
  static override description =
    "Build + validate (local + remote) + upload the bundle, replacing the project's stored one";

  static override examples = [
    "<%= config.bin %> integration-layer extension push",
    "<%= config.bin %> integration-layer extension push --force",
    "<%= config.bin %> integration-layer extension push --all",
    "<%= config.bin %> integration-layer extension push --source-revision r48211",
    "<%= config.bin %> integration-layer extension push --no-source-revision",
  ];

  static override flags = {
    entry: Flags.string({ description: "extension entry source file", default: defaultEntry() }),
    out: Flags.string({ description: "bundle output file", default: defaultOutfile() }),
    all: Flags.boolean({
      description:
        "merge every extension under ./extensions/* into ONE combined bundle and push that single artifact (the deployed shape)",
      default: false,
    }),
    "extensions-dir": Flags.string({
      description: "directory holding the extension packages (used with --all)",
      default: "extensions",
    }),
    force: Flags.boolean({
      char: "f",
      description: "upload despite a failing REMOTE validation (the local check always hard-fails)",
      default: false,
    }),
    // Provenance. The default is auto-detection from the working copy, so a plain
    // `push` records where the build came from with no ceremony; the flag is for a
    // non-git VCS, a CI build id, or anything else the integrator identifies revisions
    // by (the integration layer stores an opaque string).
    "source-revision": Flags.string({
      description:
        "version-control revision this build came from (default: detected from the git working copy; also settable via EXTENSION_SOURCE_REVISION)",
      env: "EXTENSION_SOURCE_REVISION",
      exclusive: ["no-source-revision"],
    }),
    "no-source-revision": Flags.boolean({
      description: "push without recording any source revision",
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

    // Which of the integrator's revisions this build came from. Reported so the
    // Merchant Center, the connector's log lines and `{ _extensionBundle }` can all
    // name it. Detected from the working copy unless the caller said otherwise; a
    // build outside version control simply reports none (see sourceRevision.ts).
    const sourceRevision = flags["no-source-revision"]
      ? undefined
      : await resolveSourceRevision(flags["source-revision"], process.cwd());
    if (sourceRevision) {
      this.log(`Source revision: ${sourceRevision}`);
    } else if (!flags["no-source-revision"]) {
      // Say so rather than staying silent: the operator console and the connector
      // logs will show no revision for this push, and that's worth knowing now.
      this.logToStderr(
        "⚠ no source revision detected (not a git checkout?) — pushing without one. " +
          "Pass --source-revision to record one explicitly.",
      );
    }

    const url = `${baseUrl}/${encodeURIComponent(projectKey)}/extension/bundle`;
    this.log(`Pushing extension bundle (${bundle.length} bytes) → ${url}`);
    const meta = await pushBundle(baseUrl, projectKey, token, bundle, filename, sourceRevision);
    this.log(`✓ stored revision ${meta.version} (${meta.length} bytes, filename ${meta.filename ?? filename})`);
    if (meta.sourceRevision) {
      this.log(`  built from ${meta.sourceRevision}`);
    }
  }
}
