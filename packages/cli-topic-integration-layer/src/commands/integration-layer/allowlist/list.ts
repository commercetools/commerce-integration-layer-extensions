import { getAllowlist } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class AllowlistList extends IntegrationLayerCommand {
  static override description =
    "List the project's extension HTTP allowlist — the hosts the extension sandbox's fetch may reach";

  static override examples = ["<%= config.bin %> integration-layer allowlist list"];

  async run(): Promise<void> {
    const { flags } = await this.parse(AllowlistList);
    const { baseUrl, projectKey, token } = await this.resolveIlContext(flags);
    const { allow, deny } = await getAllowlist(baseUrl, projectKey, token);

    if (allow.length === 0) {
      this.log(`No allowlisted hosts for '${projectKey}' — the extension's fetch can reach nothing.`);
    } else {
      this.log(`Allowed hosts for '${projectKey}':`);
      for (const host of allow) this.log(`  ${host}`);
    }

    // The operator deny ceiling is informational: a host is reachable only if it
    // matches `allow` AND not `deny`. It is not editable from here.
    if (deny.length > 0) {
      this.log("");
      this.log("Denied by the operator (takes precedence, read-only):");
      for (const host of deny) this.log(`  ${host}`);
    }
  }
}
