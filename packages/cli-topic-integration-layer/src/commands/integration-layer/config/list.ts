import { listConfig } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class ConfigList extends IntegrationLayerCommand {
  static override description = "List the project's extension config entries (secret values masked)";

  static override examples = ["<%= config.bin %> integration-layer config list"];

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigList);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const entries = await listConfig(baseUrl, projectKey, authFetch);
    if (entries.length === 0) {
      this.log(`No extension config entries for '${projectKey}'.`);
      return;
    }
    for (const e of entries) {
      const value = e.secret ? "•••••• (secret)" : String(e.value ?? "");
      this.log(`${e.key} = ${value}`);
    }
  }
}
