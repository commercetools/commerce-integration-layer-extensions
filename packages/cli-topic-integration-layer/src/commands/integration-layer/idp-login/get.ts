import { Flags } from "@oclif/core";
import { getIdpConfig } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class IdpLoginGet extends IntegrationLayerCommand {
  static override description =
    "Show the project's external identity provider (IdP login) configuration; the client secret is never shown";

  static override examples = [
    "<%= config.bin %> integration-layer idp-login get",
    "<%= config.bin %> integration-layer idp-login get --json",
  ];

  static override flags = {
    json: Flags.boolean({ description: "print the configuration as JSON", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IdpLoginGet);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const idp = await getIdpConfig(baseUrl, projectKey, authFetch);

    if (flags.json) {
      this.log(JSON.stringify(idp, null, 2));
      return;
    }
    if (!idp) {
      this.log(`No IdP login is configured for '${projectKey}'.`);
      return;
    }
    this.log(`IdP login for '${projectKey}':`);
    this.log(`  issuer:                  ${idp.issuer}`);
    this.log(`  token endpoint:          ${idp.tokenEndpoint}`);
    this.log(`  revocation endpoint:     ${idp.revocationEndpoint}`);
    this.log(`  jwks uri:                ${idp.jwksUri}`);
    if (idp.authorizationEndpoint) {
      this.log(`  authorization endpoint:  ${idp.authorizationEndpoint}`);
    }
    this.log(`  client id:               ${idp.clientId}`);
    this.log(`  client secret:           ${idp.hasClientSecret ? "set" : "not set"}`);
    this.log(`  redirect uri:            ${idp.redirectUri}`);
    this.log(`  customer matching:       by ${idp.matchStrategy}`);
    this.log("  claims:");
    for (const [field, claim] of Object.entries(idp.claims)) {
      this.log(`    ${field}: ${claim}`);
    }
  }
}
