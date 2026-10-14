import { Flags } from "@oclif/core";
import { buildRule, CHECKOUT_MODES, isCatchAll, logRules } from "../../../lib/checkoutRules.js";
import { getCheckoutConfig, putCheckoutConfig } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class CheckoutRulesAdd extends IntegrationLayerCommand {
  static override description =
    "Add a checkout rule — the first matching rule wins, so a scoped rule goes before any catch-all by default. A rule without --country and --store matches every shopper and must stay last";

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
      description: "1-based place in the match order (default: last, before any catch-all rule)",
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
    const catchAllAt = rules.findIndex(isCatchAll);
    let index = flags.position !== undefined ? flags.position - 1 : rules.length;
    if (isCatchAll(rule)) {
      if (catchAllAt !== -1) {
        this.error(`A catch-all rule already exists (position ${catchAllAt + 1}); a second one could never match.`);
      }
      if (index !== rules.length) {
        this.error("A rule without --country and --store matches every shopper, so it must be last.");
      }
    } else if (catchAllAt !== -1) {
      if (flags.position === undefined) {
        index = catchAllAt;
      } else if (index > catchAllAt) {
        this.error(
          `--position ${flags.position} is after the catch-all rule at position ${catchAllAt + 1}, which would make the new rule unreachable.`,
        );
      }
    }
    rules.splice(index, 0, rule);

    const { checkout, version } = await putCheckoutConfig(baseUrl, projectKey, authFetch, { rules });
    this.log(`✓ added a checkout rule for '${projectKey}' (version ${version}).`);
    logRules(checkout.rules, (line) => this.log(line));
  }
}
