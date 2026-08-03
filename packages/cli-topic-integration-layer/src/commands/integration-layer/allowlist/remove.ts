import { Args, Flags } from "@oclif/core";
import { confirmAllowlistChange } from "../../../lib/allowlistPrompt.js";
import { getAllowlist, putAllowlist } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class AllowlistRemove extends IntegrationLayerCommand {
  static override description =
    "Remove one or more host patterns from the extension HTTP allowlist";

  static override examples = [
    "<%= config.bin %> integration-layer allowlist remove api.vendor.com",
    "<%= config.bin %> integration-layer allowlist remove api.vendor.com '*.algolia.net'",
    "<%= config.bin %> integration-layer allowlist remove api.vendor.com --force",
  ];

  // Variadic: read-modify-write, same as `add` — the write route replaces the whole
  // allow list, so we PUT the remaining hosts.
  static override strict = false;

  static override flags = {
    force: Flags.boolean({
      description: "apply the change without confirmation",
      default: false,
    }),
  };

  static override args = {
    host: Args.string({
      description: "host pattern to remove (as stored, e.g. api.example.com or *.example.com)",
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(AllowlistRemove);
    // Stored entries are lowercased, so match case-insensitively.
    const targets = new Set(
      (argv as string[]).map((h) => h.trim().toLowerCase()).filter((h) => h !== ""),
    );
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);

    const { allow } = await getAllowlist(baseUrl, projectKey, authFetch);
    const remaining = allow.filter((h) => !targets.has(h.toLowerCase()));

    if (remaining.length === allow.length) {
      this.log(`Nothing to remove — no matching host in the allowlist for '${projectKey}'.`);
      return;
    }

    const confirmed = await confirmAllowlistChange({
      projectKey,
      action: "remove",
      current: allow,
      next: remaining,
      force: flags.force,
      log: (line) => this.log(line),
      abort: (message) => this.error(message),
    });
    if (!confirmed) {
      this.log("Aborted.");
      return;
    }

    const { allow: result, version } = await putAllowlist(baseUrl, projectKey, authFetch, remaining);
    this.log(`✓ removed ${[...targets].map((h) => `'${h}'`).join(", ")} from '${projectKey}' (version ${version}).`);
    this.log(result.length > 0 ? `Allowed hosts: ${result.join(", ")}` : "Allowed hosts: (none)");
  }
}
