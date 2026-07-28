import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Flags } from "@oclif/core";
import { defaultEntry, defaultOutfile } from "../../../lib/tooling/build.js";
import { bundleForFlags } from "../../../lib/tooling/extensions.js";
import { validateBundle, BundleValidationError } from "../../../lib/tooling/validateBundle.js";
import { pushBundle, remoteValidate, type RemoteValidationResult } from "../../../lib/ilClient.js";
import { awaitBundleState, type BundleOutcome } from "../../../lib/awaitBundleState.js";
import { resolveSourceRevision } from "../../../lib/sourceRevision.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

// How often to re-read the bundle's status while waiting. The extension re-reads its
// bundle on its own ~30s poll, so a tighter interval just adds requests without
// learning anything sooner; 5s keeps the command feeling responsive when the
// extension happens to be mid-poll already.
const POLL_INTERVAL_MS = 5000;

/**
 * Name a build the way its author recognises it: the integration layer's version
 * number AND the source revision it was built from. The number is an internal
 * counter — the commit is the identity. Falls back to the bare version when the
 * push recorded no revision.
 */
function describeBuild(version: number, sourceRevision?: string): string {
  return sourceRevision
    ? `version ${version} (source revision ${sourceRevision})`
    : `version ${version}`;
}

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
    // A push only STORES the bundle; the extension loads it on its own poll and
    // reports back. Waiting for that verdict is the default because a push that
    // reports success while the bundle can't actually run is the thing worth
    // catching — especially in CI, where this is the difference between a green
    // pipeline and a green pipeline that shipped a broken extension.
    wait: Flags.boolean({
      description:
        "wait for the extension to load the pushed version and report back (use --no-wait to return as soon as it is stored)",
      default: true,
      allowNo: true,
    }),
    "wait-timeout": Flags.integer({
      description:
        "seconds to wait for the pushed version to be confirmed before giving up (the push still stands)",
      default: 180,
    }),
  };

  /**
   * Report how the pushed version fared and say whether the command should fail.
   *
   * Only a genuine `failed` verdict is an error. Not being ABLE to find out — an
   * older integration layer, an extension that isn't deployed, a metadata read that
   * errored — is reported honestly and left as a success, because the push itself
   * did land and failing it would break workflows that never had this signal.
   */
  private reportOutcome(outcome: BundleOutcome, version: number): boolean {
    switch (outcome.kind) {
      case "running":
        this.log(
          `✓ ${describeBuild(version, outcome.meta.sourceRevision)} is running — the extension loaded it and published its schema`,
        );
        return false;
      case "failed": {
        this.logToStderr(
          `✗ ${describeBuild(version, outcome.meta.sourceRevision)} could not be loaded and is NOT in use.`,
        );
        if (outcome.meta.reason) this.logToStderr(`  reason: ${outcome.meta.reason}`);
        const served = outcome.meta.served;
        this.logToStderr(
          served == null
            ? "  no stored version could be loaded, so this project currently has no extension running."
            : `  ${describeBuild(served.version, served.sourceRevision)} is still in use; fix the bundle and push again.`,
        );
        return true;
      }
      case "superseded":
        this.log(
          `⚠ another push replaced version ${version} with ${describeBuild(outcome.meta.version, outcome.meta.sourceRevision)} while waiting; not reporting on it`,
        );
        return false;
      case "unknown":
        this.log(`⚠ could not confirm version ${version}: ${outcome.reason}`);
        this.log("  the bundle is stored; check the extension panel in the Merchant Center.");
        return false;
    }
  }

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

    if (!flags.wait) {
      return;
    }

    // Storing it isn't running it. Wait for the extension to actually load this
    // version and say so, and fail the command if it couldn't — otherwise a bundle
    // the sandbox refuses to run exits 0 and looks like a successful push.
    this.log(`Waiting for the extension to load version ${meta.version}…`);
    const outcome = await awaitBundleState(baseUrl, projectKey, token, meta.version, {
      timeoutMs: flags["wait-timeout"] * 1000,
      intervalMs: POLL_INTERVAL_MS,
    });
    if (this.reportOutcome(outcome, meta.version)) {
      this.error("The pushed bundle could not be loaded.");
    }
  }
}
