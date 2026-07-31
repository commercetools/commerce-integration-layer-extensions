import { Args } from "@oclif/core";
import { putAllowlist } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class AllowlistSet extends IntegrationLayerCommand {
  static override description =
    "Replace the ENTIRE extension HTTP allowlist with the given host patterns (pass none to clear)";

  static override examples = [
    "<%= config.bin %> integration-layer allowlist set api.vendor.com '*.algolia.net'",
    "<%= config.bin %> integration-layer allowlist set   # clears the allowlist",
  ];

  // Variadic and non-required: this is a full replace, so zero hosts clears the list.
  static override strict = false;

  static override args = {
    host: Args.string({
      description: "host pattern to allow (bare host, e.g. api.example.com or *.example.com)",
    }),
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AllowlistSet);
    const hosts = (argv as string[]).map((h) => h.trim()).filter((h) => h !== "");
    const { baseUrl, projectKey, token } = await this.resolveIlContext(flags);

    const { allow, version } = await putAllowlist(baseUrl, projectKey, token, hosts);
    if (allow.length === 0) {
      this.log(`✓ cleared the allowlist for '${projectKey}' (version ${version}).`);
      return;
    }
    this.log(`✓ set the allowlist for '${projectKey}' (version ${version}).`);
    this.log(`Allowed hosts: ${allow.join(", ")}`);
  }
}
