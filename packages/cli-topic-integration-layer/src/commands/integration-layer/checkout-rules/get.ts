import { Flags } from "@oclif/core";
import { logRules } from "../../../lib/checkoutRules.js";
import { getCheckoutConfig } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class CheckoutRulesGet extends IntegrationLayerCommand {
  static override description =
    "List the project's checkout rules in match order — the first rule matching a shopper's country and store selects the Checkout Application";

  static override examples = [
    "<%= config.bin %> integration-layer checkout-rules get",
    "<%= config.bin %> integration-layer checkout-rules get --json",
  ];

  static override flags = {
    json: Flags.boolean({ description: "print the rules as JSON", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(CheckoutRulesGet);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const checkout = await getCheckoutConfig(baseUrl, projectKey, authFetch);

    if (flags.json) {
      this.log(JSON.stringify(checkout ?? { rules: [] }, null, 2));
      return;
    }
    if (!checkout || checkout.rules.length === 0) {
      this.log(`No checkout rules are configured for '${projectKey}'.`);
      return;
    }
    this.log(`Checkout rules for '${projectKey}' (first match wins):`);
    logRules(checkout.rules, (line) => this.log(line));
  }
}
