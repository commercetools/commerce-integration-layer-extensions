import { Flags } from "@oclif/core";
import {
  getProjectSettings,
  putProjectSettings,
  type ProjectSettings,
} from "../../../lib/ilClient.js";
import { canonicalisePresentment, fetchProjectPresentment } from "../../../lib/ctProject.js";
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
    language: Flags.string({ description: "default language, e.g. en-US; must be one of the project's languages" }),
    currency: Flags.string({ description: "default currency (ISO 4217), e.g. EUR; must be one of the project's currencies" }),
    country: Flags.string({ description: "default presentment country (ISO 3166-1 alpha-2), e.g. DE; must be one of the project's countries" }),
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

    // The Commerce Integration Layer stores these defaults unchecked and later seeds new
    // sessions with them, so a value the project doesn't present would only fail there.
    // Check the ones being changed against the commercetools project, as the Merchant
    // Center's dropdowns do. A label-only change needs no commercetools call.
    const presented = (["language", "currency", "country"] as const).filter((k) => patch[k] !== undefined);
    if (presented.length > 0) {
      const presentment = await fetchProjectPresentment(
        this.requirePrincipal().getRegion(),
        projectKey,
        authFetch,
      );
      for (const field of presented) {
        try {
          patch[field] = canonicalisePresentment(presentment, projectKey, field, patch[field]!);
        } catch (e) {
          this.error((e as Error).message);
        }
      }
    }

    // The route replaces the whole section, so merge onto the current values.
    const { project: current } = await getProjectSettings(baseUrl, projectKey, authFetch);
    const merged: ProjectSettings = {
      label: current.label,
      language: current.language,
      currency: current.currency,
      country: current.country,
      ...patch,
    };
    // The route needs all four. A stored value can be missing (a project that predates a
    // field), and then only the caller can supply it.
    const missing = (["label", "language", "currency", "country"] as const).filter((k) => !merged[k]);
    if (missing.length > 0) {
      this.error(
        `'${projectKey}' has no stored ${missing.join(", ")} — pass ${missing.map((k) => `--${k}`).join(", ")}.`,
      );
    }
    const { project, version } = await putProjectSettings(baseUrl, projectKey, authFetch, merged);

    this.log(`✓ updated the settings for '${projectKey}' (version ${version}).`);
    this.log(`  label:    ${project.label}`);
    this.log(`  language: ${project.language}`);
    this.log(`  currency: ${project.currency}`);
    this.log(`  country:  ${project.country}`);
  }
}
