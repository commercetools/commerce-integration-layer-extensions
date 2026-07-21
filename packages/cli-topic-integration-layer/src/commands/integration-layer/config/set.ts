import { Args, Flags } from "@oclif/core";
import { patchConfig } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class ConfigSet extends IntegrationLayerCommand {
  static override description = "Create or update an extension config entry";

  static override examples = [
    "<%= config.bin %> integration-layer config set ALGOLIA_APP_ID abc123",
    "<%= config.bin %> integration-layer config set ALGOLIA_API_KEY s3cr3t --secret",
  ];

  static override args = {
    key: Args.string({ description: "the config entry key", required: true }),
    value: Args.string({ description: "the value to store", required: true }),
  };

  static override flags = {
    secret: Flags.boolean({
      description: "seal the value (write-only thereafter, encrypted at rest)",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigSet);
    const { baseUrl, projectKey, token } = await this.resolveIlContext(flags);
    await patchConfig(baseUrl, projectKey, token, [
      { key: args.key, value: args.value, secret: flags.secret },
    ]);
    this.log(`✓ set '${args.key}'${flags.secret ? " (secret)" : ""} for '${projectKey}'.`);
  }
}
