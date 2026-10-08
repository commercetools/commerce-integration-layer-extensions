import { Flags } from "@oclif/core";
import {
  getProjectSettings,
  putProjectSettings,
  type ProjectSettings,
} from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class SettingsSet extends IntegrationLayerCommand {
  static override description =
    "Update the project's settings; only the fields you pass change, the rest keep their current value";

  static override examples = [
    "<%= config.bin %> integration-layer project-settings set --label 'Acme Store' --currency EUR",
    "<%= config.bin %> integration-layer project-settings set --language de-DE --country DE",
  ];

  static override flags = {
    label: Flags.string({ description: "display name of the project" }),
    language: Flags.string({ description: "default language, e.g. en-US" }),
    currency: Flags.string({ description: "default currency (ISO 4217), e.g. EUR" }),
    country: Flags.string({ description: "default presentment country (ISO 3166-1 alpha-2), e.g. DE" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SettingsSet);

    const patch: Partial<ProjectSettings> = {};
    for (const key of ["label", "language", "currency", "country"] as const) {
      const value = flags[key]?.trim();
      if (value === undefined) continue;
      if (value === "") this.error(`--${key} must not be empty.`);
      patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      this.error("Nothing to update. Pass at least one of --label, --language, --currency, --country.");
    }

    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);

    // The route replaces the whole section, so merge onto the current values.
    const { project: current } = await getProjectSettings(baseUrl, projectKey, authFetch);
    const { project, version } = await putProjectSettings(baseUrl, projectKey, authFetch, {
      label: current.label,
      language: current.language,
      currency: current.currency,
      country: current.country,
      ...patch,
    });

    this.log(`✓ updated the settings for '${projectKey}' (version ${version}).`);
    this.log(`  label:    ${project.label}`);
    this.log(`  language: ${project.language}`);
    this.log(`  currency: ${project.currency}`);
    this.log(`  country:  ${project.country}`);
  }
}
