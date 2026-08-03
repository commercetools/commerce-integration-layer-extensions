import { readFile } from "node:fs/promises";
import { Command, Flags } from "@oclif/core";
import { defaultEntry, defaultOutfile } from "../../../lib/tooling/build.js";
import { bundleForFlags } from "../../../lib/tooling/extensions.js";
import { loadBundleSource } from "../../../lib/tooling/loadBundle.js";
import type {
  ApiExtensionAction,
  ApiExtensionInput,
} from "../../../lib/tooling/apiExtension.js";
import {
  describeResult,
  extractApiExtensions,
  handlerMatches,
} from "../../../lib/tooling/apiExtensionDispatch.js";
import { extensionConfigFromEnv, extensionConfigFromPairs } from "../../../lib/extensionConfig.js";
import { loadLocalEnv } from "../../../lib/loadLocalEnv.js";

/** The minimal envelope we read off a resolved payload to route it to handlers. */
interface ResourceEnvelope {
  action: string;
  resource: { typeId: string };
}

export default class ExtensionInvokeApiExtension extends Command {
  static override description =
    "Fire a commercetools API-Extension callback from a supplied payload at the bundle's handlers";

  static override examples = [
    "<%= config.bin %> integration-layer extension invoke-api-extension --input ./payloads/cart-create.json",
    "<%= config.bin %> integration-layer extension invoke-api-extension --input ./payloads/order-create.json --key order-tagger",
    "<%= config.bin %> integration-layer extension invoke-api-extension --all --input ./payload.json --config MAX_QTY=5",
  ];

  static override flags = {
    "env-file": Flags.string({
      description:
        "dotenv file to load before the command runs (default: .env in the cwd, if present); does not override variables already set in the environment",
    }),
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
    input: Flags.string({
      description:
        "path to a JSON commercetools ExtensionInput ({ action, resource }) — the callback payload to fire",
      required: true,
    }),
    key: Flags.string({
      description: "only invoke handlers with this key (repeatable)",
      multiple: true,
      delimiter: ",",
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

  /** Read and validate the `--input` ExtensionInput JSON file. */
  private async loadInput(inputPath: string): Promise<ApiExtensionInput> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(inputPath, "utf8"));
    } catch (err) {
      this.error(`could not read --input '${inputPath}': ${(err as Error).message}`);
    }
    const obj = (parsed ?? {}) as Record<string, unknown>;
    if (typeof obj !== "object" || obj === null) {
      this.error(`--input '${inputPath}' must be a JSON object`);
    }
    const resource = obj.resource as { typeId?: unknown } | undefined;
    if (!resource || typeof resource !== "object" || typeof resource.typeId !== "string") {
      this.error(
        `--input '${inputPath}' must be a commercetools ExtensionInput with a resource object whose typeId is a string`,
      );
    }
    if (typeof obj.action !== "string") {
      this.error(`--input '${inputPath}' must include a string action`);
    }
    return { action: obj.action, resource } as unknown as ApiExtensionInput;
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionInvokeApiExtension);

    // Environment / `.env` first; an explicit `--config` wins on the same key.
    const config = {
      ...extensionConfigFromEnv(),
      ...extensionConfigFromPairs(flags.config ?? []),
    };

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

    const handlers = extractApiExtensions(loadBundleSource(await readFile(outfile, "utf8")));
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

    const input = await this.loadInput(flags.input);
    const { action, resource } = input as unknown as ResourceEnvelope;
    const resourceType = resource.typeId;

    const ctx = { now: () => Date.now(), config };
    this.log(`Invoking ${selected.length} handler(s) with a ${action} on ${resourceType}`);

    for (const h of selected) {
      if (!handlerMatches(h, resourceType, action as ApiExtensionAction)) {
        this.log(`  · ${h.key}: skipped (does not trigger on ${resourceType}/${action})`);
        continue;
      }
      const result = await h.handler(input, ctx);
      this.log(`  → ${h.key}: ${describeResult(result)}`);
    }
  }
}
