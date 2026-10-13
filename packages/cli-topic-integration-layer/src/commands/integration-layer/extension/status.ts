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
    // undefined means a deployment that predates bundle state, not a failure.
    this.log(`  state:      ${meta.state ?? "unknown (this deployment does not report state)"}`);
    if (meta.state === "failed") this.log(`  reason:     ${meta.reason ?? "no reason reported"}`);
    // undefined = older deployment that doesn't report it; null = nothing in use.
    if (meta.served === null) {
      this.log("  served:     nothing (no version is currently in use)");
    } else if (meta.served) {
      const rev = meta.served.sourceRevision ? ` (built from ${meta.served.sourceRevision})` : "";
      const note =
        meta.served.version === meta.version
          ? "same as the newest stored version"
          : `older than the newest stored version (v${meta.version})${meta.state === "failed" ? " — the newest failed to load" : ""}`;
      this.log(`  served:     v${meta.served.version}${rev} — ${note}`);
    }
  }
}
