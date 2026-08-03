import { fetchExtensionMeta } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class ExtensionStatus extends IntegrationLayerCommand {
  static override description = "Show the project's stored extension bundle (version, size, …)";

  static override examples = ["<%= config.bin %> integration-layer extension status"];

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionStatus);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const meta = await fetchExtensionMeta(baseUrl, projectKey, authFetch);
    if (!meta) {
      this.log(`No extension bundle is stored for '${projectKey}'.`);
      return;
    }
    this.log(`Stored extension for '${projectKey}':`);
    this.log(`  version:    ${meta.version}`);
    this.log(`  size:       ${meta.length} bytes`);
    this.log(`  uploaded:   ${new Date(meta.uploadedAt).toISOString()}`);
    if (meta.filename) this.log(`  filename:   ${meta.filename}`);
    if (meta.updatedBy) this.log(`  updated by: ${meta.updatedBy}`);
    // Only when the push that stored it reported one — a bundle uploaded by hand in
    // the Merchant Center has no revision, and printing "unknown" would be noise.
    if (meta.sourceRevision) this.log(`  built from: ${meta.sourceRevision}`);
  }
}
