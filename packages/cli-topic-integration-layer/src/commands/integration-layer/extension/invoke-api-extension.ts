import { readFile } from "node:fs/promises";
import { Command, Flags } from "@oclif/core";
import { buildBundle, defaultEntry, defaultOutfile } from "../../../lib/tooling/build.js";
import { loadBundleSource } from "../../../lib/tooling/loadBundle.js";
import type {
  ApiExtensionAction,
  ApiExtensionDefinition,
  ApiExtensionInput,
  ApiExtensionResult,
} from "../../../lib/tooling/apiExtension.js";
import { extensionConfigFromEnv, extensionConfigFromPairs } from "../../../lib/extensionConfig.js";
import { loadLocalEnv } from "../../../lib/loadLocalEnv.js";

/** A sample commercetools cart callback payload. */
function sampleCartInput(
  action: ApiExtensionAction,
  sku: string,
  quantity: number,
): ApiExtensionInput {
  // A minimal sample callback for local testing. The real payload is the SDK's
  // ExtensionInput (resource: a full Cart Reference); we send just the fields a
  // cart handler reads, cast to the SDK type.
  return {
    action,
    resource: {
      typeId: "cart",
      id: "sample-cart",
      obj: {
        id: "sample-cart",
        lineItems: [{ id: "sample-line-item", quantity, variant: { sku } }],
      },
    },
  } as unknown as ApiExtensionInput;
}

function describeResult(result: ApiExtensionResult): string {
  if (result && typeof result === "object") {
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      return `BLOCK — ${result.errors.map((e) => `${e.code}: ${e.message}`).join("; ")}`;
    }
    if (Array.isArray(result.actions) && result.actions.length > 0) {
      return `MODIFY — ${JSON.stringify(result.actions)}`;
    }
  }
  return "APPROVE";
}

export default class ExtensionInvokeApiExtension extends Command {
  static override description =
    "Fire a sample commercetools cart callback at the bundle's API-Extension handlers";

  static override examples = [
    "<%= config.bin %> integration-layer extension invoke-api-extension",
    "<%= config.bin %> integration-layer extension invoke-api-extension --action Update --sku BLOCKED-SKU",
    "<%= config.bin %> integration-layer extension invoke-api-extension --quantity 25 --config MAX_LINE_QUANTITY=10",
    "<%= config.bin %> integration-layer extension invoke-api-extension --config MAX_QTY=5 --config REGION=eu",
  ];

  static override flags = {
    "env-file": Flags.string({
      description:
        "dotenv file to load before the command runs (default: .env in the cwd, if present); does not override variables already set in the environment",
    }),
    entry: Flags.string({ description: "extension entry source file", default: defaultEntry() }),
    out: Flags.string({ description: "bundle output file", default: defaultOutfile() }),
    action: Flags.string({
      description: "the trigger action",
      options: ["Create", "Update"],
      default: "Create",
    }),
    sku: Flags.string({
      description: "SKU on the sample cart's line item",
      default: "BLOCKED-SKU",
    }),
    quantity: Flags.integer({
      description: "quantity on the sample cart's line item",
      default: 1,
    }),
    config: Flags.string({
      description:
        "a ctx.config entry as KEY=VALUE (repeatable); overrides EXTENSION_CONFIG_* from the environment / .env",
      multiple: true,
      delimiter: ",",
    }),
  };

  protected override async init(): Promise<void> {
    // Load `.env` / `--env-file` into process.env before flags parse, so
    // EXTENSION_CONFIG_* is visible below (an already-set shell variable still wins).
    loadLocalEnv();
    await super.init();
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionInvokeApiExtension);

    // Environment / `.env` first; an explicit `--config` wins on the same key.
    const config = {
      ...extensionConfigFromEnv(),
      ...extensionConfigFromPairs(flags.config ?? []),
    };

    const { outfile } = await buildBundle(flags.entry, flags.out);
    const mod = loadBundleSource(await readFile(outfile, "utf8")) as { apiExtensions?: unknown };
    const handlers = Array.isArray(mod.apiExtensions)
      ? (mod.apiExtensions as ApiExtensionDefinition[])
      : [];
    if (handlers.length === 0) {
      this.error("this bundle declares no `apiExtensions`.");
    }

    const action = flags.action as ApiExtensionAction;
    const input = sampleCartInput(action, flags.sku, flags.quantity);
    const ctx = { now: () => Date.now(), config };
    this.log(
      `Invoking ${handlers.length} handler(s) with a ${input.action} on cart ` +
        `(line item SKU '${flags.sku}' x${flags.quantity})`,
    );

    for (const h of handlers) {
      if (h.resourceTypeId !== input.resource.typeId || !h.actions.includes(action)) {
        this.log(`  · ${h.key}: skipped (does not trigger on cart/${action})`);
        continue;
      }
      const result = await h.handler(input, ctx);
      this.log(`  → ${h.key}: ${describeResult(result)}`);
    }
  }
}
