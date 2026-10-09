import { readFile } from "node:fs/promises";
import { Flags } from "@oclif/core";
import { logRules, parseRules } from "../../../lib/checkoutRules.js";
import { confirm } from "../../../lib/confirmPrompt.js";
import { getCheckoutConfig, putCheckoutConfig } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export default class CheckoutRulesSet extends IntegrationLayerCommand {
  static override description =
    "Replace the ENTIRE ordered list of checkout rules with the rules in a JSON file";

  static override examples = [
    "<%= config.bin %> integration-layer checkout-rules set --file rules.json",
    "cat rules.json | <%= config.bin %> integration-layer checkout-rules set --file - --force",
  ];

  static override flags = {
    file: Flags.string({
      description:
        'JSON file with the rules, or - for stdin: an array like [{"countries":["DE"],"stores":["web"],"applicationKey":"my-app","mode":"PAYMENT_ONLY"}], or { "rules": [...] }. Order is match order.',
      required: true,
    }),
    force: Flags.boolean({ description: "apply the change without confirmation", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(CheckoutRulesSet);

    let rules;
    try {
      rules = parseRules(flags.file === "-" ? await readStdin() : await readFile(flags.file, "utf8"));
    } catch (e) {
      this.error((e as Error).message);
    }

    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const current = await getCheckoutConfig(baseUrl, projectKey, authFetch);

    const confirmed = await confirm({
      question: `Replace the checkout rules for '${projectKey}'?`,
      force: flags.force,
      abort: (message) => this.error(message),
      preview: () => {
        this.log(`Project '${projectKey}' — checkout rules set:`);
        this.log("  Current:");
        logRules(current?.rules ?? [], (line) => this.log(`  ${line}`));
        this.log("  After:");
        logRules(rules, (line) => this.log(`  ${line}`));
        this.log("");
      },
    });
    if (!confirmed) {
      this.log("Aborted.");
      return;
    }

    const { checkout, version } = await putCheckoutConfig(baseUrl, projectKey, authFetch, { rules });
    this.log(`✓ set the checkout rules for '${projectKey}' (version ${version}).`);
    logRules(checkout.rules, (line) => this.log(line));
  }
}
