import { Flags } from "@oclif/core";
import { confirm } from "../../../lib/confirmPrompt.js";
import { deleteIdpConfig, getIdpConfig } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class IdpLoginDelete extends IntegrationLayerCommand {
  static override description =
    "Remove the project's IdP login configuration — shoppers can no longer sign in through the identity provider";

  static override examples = [
    "<%= config.bin %> integration-layer idp-login delete",
    "<%= config.bin %> integration-layer idp-login delete --force",
  ];

  static override flags = {
    force: Flags.boolean({ description: "remove without confirmation", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IdpLoginDelete);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);

    const current = await getIdpConfig(baseUrl, projectKey, authFetch);
    if (!current) {
      this.log(`Nothing to remove — no IdP login is configured for '${projectKey}'.`);
      return;
    }

    const confirmed = await confirm({
      question: `Remove IdP login (${current.issuer}) from project '${projectKey}'?`,
      force: flags.force,
      abort: (message) => this.error(message),
    });
    if (!confirmed) {
      this.log("Aborted.");
      return;
    }

    await deleteIdpConfig(baseUrl, projectKey, authFetch);
    this.log(`✓ removed IdP login for '${projectKey}'.`);
  }
}
