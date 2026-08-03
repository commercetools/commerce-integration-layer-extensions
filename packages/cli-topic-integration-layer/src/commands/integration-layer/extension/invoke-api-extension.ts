import { readFile } from "node:fs/promises";
import { Command, Flags } from "@oclif/core";
import { defaultEntry, defaultOutfile } from "../../../lib/tooling/build.js";
import { bundleForFlags } from "../../../lib/tooling/extensions.js";
import { loadBundleSource } from "../../../lib/tooling/loadBundle.js";
import type {
  ApiExtensionAction,
  ApiExtensionDefinition,
  ApiExtensionInput,
  ApiExtensionResult,
} from "../../../lib/tooling/apiExtension.js";

/** The minimal envelope we read off a resolved payload to route it to handlers. */
interface ResourceEnvelope {
  action: string;
  resource: { typeId: string };
}

/**
 * A minimal sample callback payload for a resource type. `cart` gets a single line item
 * (so the cart examples have something to act on); every other type gets a bare
 * `{ id, obj: { id } }` — enough to reach a handler. A realistic payload comes via
 * `--input`; this is the zero-config convenience for the common cart case.
 */
function sampleInput(
  resourceType: string,
  action: string,
  sku: string,
  quantity: number,
): ApiExtensionInput {
  const id = `sample-${resourceType}`;
  const obj =
    resourceType === "cart"
      ? { id, lineItems: [{ id: "sample-line-item", quantity, variant: { sku } }] }
      : { id };
  return { action, resource: { typeId: resourceType, id, obj } } as unknown as ApiExtensionInput;
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
    "Fire a commercetools API-Extension callback (a built-in sample or a supplied payload) at the bundle's handlers";

  static override examples = [
    "<%= config.bin %> integration-layer extension invoke-api-extension",
    "<%= config.bin %> integration-layer extension invoke-api-extension --action Update --sku BLOCKED-SKU",
    "<%= config.bin %> integration-layer extension invoke-api-extension --resource-type order --action Create",
    "<%= config.bin %> integration-layer extension invoke-api-extension --input ./payloads/order-create.json",
    "<%= config.bin %> integration-layer extension invoke-api-extension --key my-handler --input ./payload.json",
    "<%= config.bin %> integration-layer extension invoke-api-extension --all --config MAX_QTY=5",
  ];

  static override flags = {
    entry: Flags.string({
      description:
        "extension entry source file (with --all: the per-package source segment applied under each ./extensions/*)",
      default: defaultEntry(),
    }),
    out: Flags.string({ description: "bundle output file", default: defaultOutfile() }),
    all: Flags.boolean({
      description:
        "invoke the ONE combined bundle merged from every extension under ./extensions/* (the deployed shape)",
      default: false,
    }),
    "extensions-dir": Flags.string({
      description: "directory holding the extension packages (used with --all)",
      default: "extensions",
    }),
    action: Flags.string({
      description: "the trigger action (also fills the action when --input omits one)",
      options: ["Create", "Update"],
      default: "Create",
    }),
    "resource-type": Flags.string({
      description: "commercetools resource the sample callback targets (e.g. cart, order, payment)",
      default: "cart",
    }),
    input: Flags.string({
      description:
        "path to a JSON commercetools ExtensionInput ({ action, resource }, or a bare resource) — call any handler with a real payload; overrides --resource-type/--sku/--quantity",
    }),
    key: Flags.string({
      description: "only invoke handlers with this key (repeatable)",
      multiple: true,
      delimiter: ",",
    }),
    sku: Flags.string({
      description: "SKU on the sample cart's line item (cart sample only)",
      default: "BLOCKED-SKU",
    }),
    quantity: Flags.integer({
      description: "quantity on the sample cart's line item (cart sample only)",
      default: 1,
    }),
    config: Flags.string({
      description: "a ctx.config entry as KEY=VALUE (repeatable)",
      multiple: true,
      delimiter: ",",
    }),
  };

  /**
   * The payload to hand the handlers: a supplied `--input` JSON file (a full
   * `{ action, resource }` ExtensionInput, or a bare resource object — the action then
   * comes from `--action`), otherwise the built-in sample for `--resource-type`.
   */
  private async resolveInput(flags: {
    input?: string;
    action: string;
    "resource-type": string;
    sku: string;
    quantity: number;
  }): Promise<ApiExtensionInput> {
    if (!flags.input) {
      return sampleInput(flags["resource-type"], flags.action, flags.sku, flags.quantity);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(flags.input, "utf8"));
    } catch (err) {
      this.error(`could not read --input '${flags.input}': ${(err as Error).message}`);
    }
    const obj = (parsed ?? {}) as Record<string, unknown>;
    const resource = (typeof obj === "object" && "resource" in obj ? obj.resource : obj) as
      | { typeId?: unknown }
      | undefined;
    if (!resource || typeof resource !== "object" || typeof resource.typeId !== "string") {
      this.error(
        `--input '${flags.input}' must be a commercetools ExtensionInput: a { action, resource } object ` +
          "(or a bare resource) whose resource has a string typeId",
      );
    }
    const action = typeof obj.action === "string" ? obj.action : flags.action;
    return { action, resource } as unknown as ApiExtensionInput;
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionInvokeApiExtension);

    const config: Record<string, string> = {};
    for (const pair of flags.config ?? []) {
      const eq = pair.indexOf("=");
      if (eq > 0) config[pair.slice(0, eq)] = pair.slice(eq + 1);
    }

    let outfile: string;
    try {
      ({ outfile } = await bundleForFlags({
        all: flags.all,
        extensionsDir: flags["extensions-dir"],
        entry: flags.entry,
        out: flags.out,
      }));
    } catch (err) {
      this.error((err as Error).message);
    }

    const mod = loadBundleSource(await readFile(outfile, "utf8")) as { apiExtensions?: unknown };
    const handlers = Array.isArray(mod.apiExtensions)
      ? (mod.apiExtensions as ApiExtensionDefinition[])
      : [];
    if (handlers.length === 0) {
      this.error("this bundle declares no `apiExtensions`.");
    }

    // --key narrows to named handlers. Warn on a key no handler owns, then fail if the
    // filter leaves nothing to call — a named key that isn't there is a mistake worth surfacing.
    const wanted = flags.key && flags.key.length > 0 ? new Set(flags.key) : undefined;
    if (wanted) {
      const known = new Set(handlers.map((h) => h.key));
      for (const k of wanted) if (!known.has(k)) this.warn(`no handler with key '${k}' in this bundle`);
    }
    const selected = wanted ? handlers.filter((h) => wanted.has(h.key)) : handlers;
    if (selected.length === 0) {
      this.error(`no handler matched --key ${[...(wanted ?? [])].join(", ")}`);
    }

    const input = await this.resolveInput(flags);
    const { action, resource } = input as unknown as ResourceEnvelope;
    const resourceType = resource.typeId;

    const ctx = { now: () => Date.now(), config };
    const detail =
      resourceType === "cart" && !flags.input
        ? ` (line item SKU '${flags.sku}' x${flags.quantity})`
        : "";
    this.log(`Invoking ${selected.length} handler(s) with a ${action} on ${resourceType}${detail}`);

    for (const h of selected) {
      if (h.resourceTypeId !== resourceType || !h.actions.includes(action as ApiExtensionAction)) {
        this.log(`  · ${h.key}: skipped (does not trigger on ${resourceType}/${action})`);
        continue;
      }
      const result = await h.handler(input, ctx);
      this.log(`  → ${h.key}: ${describeResult(result)}`);
    }
  }
}
