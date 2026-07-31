import { Args } from "@oclif/core";
import { getAllowlist, putAllowlist } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class AllowlistAdd extends IntegrationLayerCommand {
  static override description =
    "Add one or more host patterns to the extension HTTP allowlist (exact host or *.suffix)";

  static override examples = [
    "<%= config.bin %> integration-layer allowlist add api.vendor.com",
    "<%= config.bin %> integration-layer allowlist add api.vendor.com '*.algolia.net'",
  ];

  // Variadic: the write route replaces the whole allow list, so we read it, merge in
  // the new hosts, and PUT the union. Any number of hosts in one call.
  static override strict = false;

  static override args = {
    host: Args.string({
      description: "host pattern to allow (bare host, e.g. api.example.com or *.example.com)",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AllowlistAdd);
    const hosts = (argv as string[]).map((h) => h.trim()).filter((h) => h !== "");
    const { baseUrl, projectKey, token } = await this.resolveIlContext(flags);

    const { allow } = await getAllowlist(baseUrl, projectKey, token);
    // Existing entries are stored lowercased; compare case-insensitively so we don't
    // re-send a host that's already there (the Commerce Integration Layer would de-dupe anyway).
    const existing = new Set(allow.map((h) => h.toLowerCase()));
    const added = hosts.filter((h) => !existing.has(h.toLowerCase()));

    if (added.length === 0) {
      this.log(`Nothing to add — every host is already allowed for '${projectKey}'.`);
      return;
    }

    // The Commerce Integration Layer validates + normalizes (lowercase, de-dupe) on write.
    const { allow: result, version } = await putAllowlist(baseUrl, projectKey, token, [
      ...allow,
      ...added,
    ]);
    this.log(`✓ added ${added.map((h) => `'${h}'`).join(", ")} for '${projectKey}' (version ${version}).`);
    this.log(`Allowed hosts: ${result.join(", ")}`);
  }
}
