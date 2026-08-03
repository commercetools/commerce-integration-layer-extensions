import { readFile } from "node:fs/promises";
import { Flags } from "@oclif/core";
import { defaultEntry, defaultOutfile } from "../../../lib/tooling/build.js";
import { bundleForFlags } from "../../../lib/tooling/extensions.js";
import { loadBundleSource } from "../../../lib/tooling/loadBundle.js";
import type {
  ApiExtensionAction,
  ApiExtensionDefinition,
  ApiExtensionInput,
  ApiExtensionResult,
} from "../../../lib/tooling/apiExtension.js";
import { extensionConfigFromEnv, extensionConfigFromPairs } from "../../../lib/extensionConfig.js";
import { IntegrationLayerCommand, type IlFlagValues } from "../../../lib/base.js";
import { invokeDeployedApiExtension } from "../../../lib/ilClient.js";

/** The minimal envelope we read off a resolved payload to route it to handlers. */
interface ResourceEnvelope {
  action: string;
  resource: { typeId: string };
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

export default class ExtensionInvokeApiExtension extends IntegrationLayerCommand {
  static override description =
    "Fire a commercetools API-Extension callback from a supplied payload — at the LOCAL bundle's handlers, or (with --deployed) at the project's DEPLOYED extension through the Commerce Integration Layer";

  static override examples = [
    "<%= config.bin %> integration-layer extension invoke-api-extension --input ./payloads/cart-create.json",
    "<%= config.bin %> integration-layer extension invoke-api-extension --input ./payloads/order-create.json --key order-tagger",
    "<%= config.bin %> integration-layer extension invoke-api-extension --all --input ./payload.json --config MAX_QTY=5",
    "<%= config.bin %> integration-layer extension invoke-api-extension --deployed --input ./payloads/cart-create.json",
  ];

  // Local (in-process) invocation needs no login; --deployed resolves the context
  // lazily and then requires a logged-in principal (see run → runDeployed).
  protected override authorized = false;

  static override flags = {
    entry: Flags.string({
      description:
        "extension entry source file (with --all: the per-package source segment applied under each ./extensions/*); local invocation only",
      default: defaultEntry(),
    }),
    out: Flags.string({
      description: "bundle output file; local invocation only",
      default: defaultOutfile(),
    }),
    all: Flags.boolean({
      description:
        "invoke the ONE combined bundle merged from every extension under ./extensions/* (the deployed shape); local invocation only",
      default: false,
    }),
    "extensions-dir": Flags.string({
      description: "directory holding the extension packages (used with --all); local invocation only",
      default: "extensions",
    }),
    input: Flags.string({
      description:
        "path to a JSON commercetools ExtensionInput ({ action, resource }) — the callback payload to fire",
      required: true,
    }),
    key: Flags.string({
      description:
        "only invoke handlers with this key (repeatable); local invocation only — the deployed connector returns one merged verdict",
      multiple: true,
      delimiter: ",",
    }),
    config: Flags.string({
      description:
        "a ctx.config entry as KEY=VALUE (repeatable); overrides EXTENSION_CONFIG_* from the environment / .env; local invocation only — --deployed uses the project's stored config",
      multiple: true,
      delimiter: ",",
    }),
    deployed: Flags.boolean({
      description:
        "fire the callback at the project's DEPLOYED extension through the Commerce Integration Layer (requires `commercetools auth login`) instead of running the local bundle in-process",
      default: false,
    }),
  };

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
    const { flags, metadata } = await this.parse(ExtensionInvokeApiExtension);

    if (flags.deployed) {
      // --deployed reaches the DEPLOYED extension through the integration layer, so the
      // local-bundle knobs (which build/merge/configure a bundle here) are meaningless
      // — reject them loudly rather than silently ignore. `entry`/`out`/`extensions-dir`
      // carry defaults, so only complain when the user set them explicitly.
      const localOnly: string[] = [];
      if (flags.all) localOnly.push("--all");
      if (flags.config && flags.config.length > 0) localOnly.push("--config");
      if (flags.key && flags.key.length > 0) localOnly.push("--key");
      for (const name of ["entry", "out", "extensions-dir"] as const) {
        if (metadata.flags[name] && !metadata.flags[name].setFromDefault) localOnly.push(`--${name}`);
      }
      if (localOnly.length > 0) {
        this.error(
          `--deployed fires the callback at the DEPLOYED extension through the Commerce Integration Layer, ` +
            `so it can't be combined with the local-bundle flag(s): ${localOnly.join(", ")}. ` +
            `--deployed uses the deployed code and the project's stored config, and returns the ` +
            `connector's single merged verdict (there is no per-key breakdown).`,
        );
      }
      await this.runDeployed(flags);
      return;
    }

    await this.runLocal(flags);
  }

  /**
   * Fire the callback at the project's DEPLOYED extension via the integration layer's
   * signing proxy, and print the connector's verdict. The IL is the only party that can
   * sign the connector's `/api-extensions` call (the shared secret never leaves it), so
   * the CLI hands it the payload and renders what comes back. Nothing is persisted.
   */
  private async runDeployed(flags: IlFlagValues & { input: string }): Promise<void> {
    const input = await this.loadInput(flags.input);
    const { action, resource } = input as unknown as ResourceEnvelope;
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);

    // Deployed is ALWAYS the live extension — say so before firing. It runs the real
    // callback against the deployed connector; it just doesn't persist the write.
    this.warn(
      `invoking the LIVE deployed extension for project '${projectKey}' — this runs the real ` +
        `API-Extension callback against the deployed connector (no write is persisted to commercetools)`,
    );
    this.log(`Invoking the deployed extension with a ${action} on ${resource.typeId} …`);

    const { status, result } = await invokeDeployedApiExtension(baseUrl, projectKey, authFetch, input);

    // 200 (approve/modify) and 400 (block) are the extension's VERDICT — render them.
    // Any other status is the connector failing to answer cleanly, not a decision.
    if (status === 200 || status === 400) {
      this.log(`  → ${describeResult(result as ApiExtensionResult)} (connector HTTP ${status})`);
    } else {
      this.warn(
        `the deployed extension returned HTTP ${status} (not an approve/modify/block verdict): ` +
          `${typeof result === "string" ? result : JSON.stringify(result)}`,
      );
    }
  }

  /** Invoke the bundle's handlers IN-PROCESS against the supplied payload (offline). */
  private async runLocal(flags: {
    all: boolean;
    "extensions-dir": string;
    entry: string;
    out: string;
    input: string;
    key?: string[];
    config?: string[];
  }): Promise<void> {
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

    const input = await this.loadInput(flags.input);
    const { action, resource } = input as unknown as ResourceEnvelope;
    const resourceType = resource.typeId;

    const ctx = { now: () => Date.now(), config };
    this.log(`Invoking ${selected.length} handler(s) with a ${action} on ${resourceType}`);

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
