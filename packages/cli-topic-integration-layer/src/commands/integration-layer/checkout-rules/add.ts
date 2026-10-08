import { Flags } from "@oclif/core";
import { buildRule, CHECKOUT_MODES, logRules } from "../../../lib/checkoutRules.js";
import { getCheckoutConfig, putCheckoutConfig } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class CheckoutRulesAdd extends IntegrationLayerCommand {
  static override description =
    "Add a checkout rule — appended last by default, since the first matching rule wins. A rule without --country and --store matches every shopper";

  static override examples = [
    "<%= config.bin %> integration-layer checkout-rules add --application-key eu-checkout --country DE,AT --mode COMPLETE",
    "<%= config.bin %> integration-layer checkout-rules add --application-key default-checkout",
    "<%= config.bin %> integration-layer checkout-rules add --application-key vip --store vip-store --position 1",
  ];

  static override flags = {
    "application-key": Flags.string({
      description: "key of the commercetools Checkout Application",
      required: true,
    }),
    mode: Flags.string({
      description: "the mode the Application runs in",
      options: [...CHECKOUT_MODES],
      default: "PAYMENT_ONLY",
    }),
    country: Flags.string({
      description: "country the rule matches (ISO 3166-1 alpha-2); repeat or comma-separate. Omit to match any",
      multiple: true,
      delimiter: ",",
    }),
    store: Flags.string({
      description: "store key the rule matches; repeat or comma-separate. Omit to match any",
      multiple: true,
      delimiter: ",",
    }),
    position: Flags.integer({
      description: "1-based place in the match order (default: last)",
      min: 1,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(CheckoutRulesAdd);

    let rule;
    try {
      rule = buildRule({
        countries: flags.country,
        stores: flags.store,
        applicationKey: flags["application-key"],
        mode: flags.mode,
      });
    } catch (e) {
      this.error((e as Error).message);
    }

    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const rules = [...((await getCheckoutConfig(baseUrl, projectKey, authFetch))?.rules ?? [])];

    if (flags.position !== undefined && flags.position > rules.length + 1) {
      this.error(`--position ${flags.position} is out of range (${rules.length} rule(s) exist).`);
    }
    rules.splice(flags.position !== undefined ? flags.position - 1 : rules.length, 0, rule);

    const { checkout, version } = await putCheckoutConfig(baseUrl, projectKey, authFetch, { rules });
    this.log(`✓ added a checkout rule for '${projectKey}' (version ${version}).`);
    logRules(checkout.rules, (line) => this.log(line));
  }
}
