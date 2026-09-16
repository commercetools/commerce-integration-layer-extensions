import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Flags } from "@oclif/core";
import { fetchBundleSource } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

/** Whether a path already exists — a plain existence probe (F_OK). */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export default class ExtensionPull extends IntegrationLayerCommand {
  static override description =
    "Download the project's stored extension bundle (the served .cjs) to a file";

  static override examples = [
    "<%= config.bin %> integration-layer extension pull",
    "<%= config.bin %> integration-layer extension pull --out ./dist/extension.cjs",
    "<%= config.bin %> integration-layer extension pull --force",
  ];

  static override flags = {
    out: Flags.string({
      description: "file to write the bundle to (default: the stored filename under ./dist)",
    }),
    force: Flags.boolean({
      char: "f",
      description: "overwrite the output file if it already exists",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionPull);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);

    const downloaded = await fetchBundleSource(baseUrl, projectKey, authFetch);
    if (!downloaded) {
      this.log(`No extension bundle is stored for '${projectKey}'.`);
      return;
    }

    // Default to the name the bundle was uploaded under, so a pull → push round-trip
    // keeps the same file; fall back to `extension.cjs` only if the store didn't send one.
    const outfile = flags.out ?? join(process.cwd(), "dist", downloaded.filename ?? "extension.cjs");
    // Don't clobber an existing file silently — a pull is easy to fire at the wrong
    // path, and the local copy might be the only one. Make overwriting explicit.
    if (!flags.force && (await exists(outfile))) {
      this.error(`${outfile} already exists — pass --force to overwrite it.`);
    }
    await mkdir(dirname(outfile), { recursive: true });
    await writeFile(outfile, downloaded.bundle);

    this.log(`✓ wrote ${downloaded.bundle.length} bytes → ${outfile}`);
    if (downloaded.version !== undefined) this.log(`  version:     ${downloaded.version}`);
    // Only when the push that stored it reported one — a bundle uploaded by hand in
    // the Merchant Center has no revision.
    if (downloaded.sourceRevision) this.log(`  built from:  ${downloaded.sourceRevision}`);
  }
}
