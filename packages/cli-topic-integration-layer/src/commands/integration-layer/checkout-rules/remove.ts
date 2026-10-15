import { Args, Flags } from "@oclif/core";
import { formatRule, logRules } from "../../../lib/checkoutRules.js";
import { confirm } from "../../../lib/confirmPrompt.js";
import { getCheckoutConfig, putCheckoutConfig } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class CheckoutRulesRemove extends IntegrationLayerCommand {
  static override description =
    "Remove one checkout rule by its position (as shown by `checkout-rules get`)";

  static override examples = [
    "<%= config.bin %> integration-layer checkout-rules remove 2",
    "<%= config.bin %> integration-layer checkout-rules remove 2 --force",
  ];

  static override flags = {
    force: Flags.boolean({ description: "apply the change without confirmation", default: false }),
  };

  static override args = {
    position: Args.integer({ description: "1-based position of the rule to remove", required: true, min: 1 }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(CheckoutRulesRemove);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const rules = [...((await getCheckoutConfig(baseUrl, projectKey, authFetch))?.rules ?? [])];

    if (args.position > rules.length) {
      this.error(`No rule at position ${args.position} — '${projectKey}' has ${rules.length} rule(s).`);
    }
    if (rules.length === 1) {
      // The route requires at least one rule; use `set` to replace instead.
      this.error("Cannot remove the last rule — a project's checkout needs at least one. Use 'checkout-rules set' to replace it.");
    }

    const [removed] = rules.splice(args.position - 1, 1);
    const confirmed = await confirm({
      question: `Remove rule ${formatRule(removed, args.position - 1)}?`,
      force: flags.force,
      abort: (message) => this.error(message),
    });
    if (!confirmed) {
      this.log("Aborted.");
      return;
    }

    const { checkout, version } = await putCheckoutConfig(baseUrl, projectKey, authFetch, { rules });
    this.log(`✓ removed the rule (version ${version}).`);
    logRules(checkout.rules, (line) => this.log(line));
  }
}
