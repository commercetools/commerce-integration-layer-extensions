import { Args, Flags } from "@oclif/core";
import { confirmAllowlistChange } from "../../../lib/allowlistPrompt.js";
import { getAllowlist, putAllowlist } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class AllowlistSet extends IntegrationLayerCommand {
  static override description =
    "Replace the ENTIRE extension HTTP allowlist with the given host patterns";

  static override examples = [
    "<%= config.bin %> integration-layer allowlist set api.vendor.com '*.algolia.net'",
    "<%= config.bin %> integration-layer allowlist set api.vendor.com --force",
  ];

  // Variadic: full replace, but at least one host is required — clearing the whole
  // list in one shot is too easy to do by mistake.
  static override strict = false;

  static override flags = {
    force: Flags.boolean({
      description: "apply the change without confirmation",
      default: false,
    }),
  };

  static override args = {
    host: Args.string({
      description: "host pattern to allow (bare host, e.g. api.example.com or *.example.com)",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AllowlistSet);
    const hosts = (argv as string[]).map((h) => h.trim()).filter((h) => h !== "");
    if (hosts.length === 0) {
      this.error(
        "At least one host pattern is required. Use 'allowlist remove' to drop individual hosts.",
      );
    }
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);

    const { allow: current } = await getAllowlist(baseUrl, projectKey, authFetch);
    const confirmed = await confirmAllowlistChange({
      projectKey,
      action: "set",
      current,
      next: hosts,
      force: flags.force,
      log: (line) => this.log(line),
      abort: (message) => this.error(message),
    });
    if (!confirmed) {
      this.log("Aborted.");
      return;
    }

    const { allow, version } = await putAllowlist(baseUrl, projectKey, authFetch, hosts);
    this.log(`✓ set the allowlist for '${projectKey}' (version ${version}).`);
    this.log(`Allowed hosts: ${allow.join(", ")}`);
  }
}
