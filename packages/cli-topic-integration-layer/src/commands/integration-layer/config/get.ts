import { Args } from "@oclif/core";
import { listConfig } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class ConfigGet extends IntegrationLayerCommand {
  static override description = "Print one extension config entry (secret values masked)";

  static override examples = ["<%= config.bin %> integration-layer config get ALGOLIA_APP_ID"];

  static override args = {
    key: Args.string({ description: "the config entry key", required: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigGet);
    const { baseUrl, projectKey, token } = await this.resolveIlContext(flags);
    const entries = await listConfig(baseUrl, projectKey, token);
    const entry = entries.find((e) => e.key === args.key);
    if (!entry) {
      this.error(`No config entry '${args.key}' for '${projectKey}'.`);
    }
    const value = entry.secret ? "•••••• (secret)" : String(entry.value ?? "");
    this.log(`${entry.key} = ${value}`);
  }
}
