import { Flags } from "@oclif/core";
import { getProjectSettings } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class SettingsGet extends IntegrationLayerCommand {
  static override description =
    "Show the project's settings — label, default language, currency and country";

  static override examples = [
    "<%= config.bin %> integration-layer project-settings get",
    "<%= config.bin %> integration-layer project-settings get --json",
  ];

  static override flags = {
    json: Flags.boolean({ description: "print the settings as JSON", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SettingsGet);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const { project, platform } = await getProjectSettings(baseUrl, projectKey, authFetch);

    if (flags.json) {
      this.log(JSON.stringify(project, null, 2));
      return;
    }
    this.log(`Settings for '${projectKey}':`);
    this.log(`  label:    ${project.label}`);
    this.log(`  language: ${project.language}`);
    this.log(`  currency: ${project.currency}`);
    this.log(`  country:  ${project.country}`);
    this.log(`  region:   ${platform.regionId} (read-only)`);
  }
}
