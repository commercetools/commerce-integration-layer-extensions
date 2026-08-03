import { Args } from "@oclif/core";
import { patchConfig } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class ConfigUnset extends IntegrationLayerCommand {
  static override description = "Remove an extension config entry";

  static override examples = ["<%= config.bin %> integration-layer config unset ALGOLIA_APP_ID"];

  static override args = {
    key: Args.string({ description: "the config entry key", required: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigUnset);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    // A PATCH entry with `value: null` deletes that key (Commerce Integration Layer contract).
    await patchConfig(baseUrl, projectKey, authFetch, [{ key: args.key, value: null }]);
    this.log(`✓ removed '${args.key}' from '${projectKey}'.`);
  }
}
