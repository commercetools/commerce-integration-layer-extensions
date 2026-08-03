// Local end-to-end debugging for commercetools API Extensions.
//
// `invoke-api-extension` fires a SYNTHETIC payload at a bundle's `apiExtensions`
// handlers offline. This command closes the loop the other way: it serves those
// handlers over HTTP and registers a commercetools API Extension that points at them,
// so a REAL cart/order write in the project calls the code on your machine — with a
// debugger attached, breakpoints, and hot-reload. It is the API-Extension analogue of
// `serve` (which does the same for the GraphQL subgraph).
//
// commercetools is in the cloud, so it must reach a PUBLIC https URL: run your own
// tunnel (e.g. `ngrok http 4000`, `cloudflared`) and pass its address as
// `--public-url`. The command mints a random shared secret, gates the local callback
// on it, and registers it as the Extension's Authorization header — so nothing but
// commercetools (carrying that secret) can invoke your handlers.
//
// SAFETY MODEL (deliberately strict — these callbacks make commercetools call YOUR
// laptop before persisting a write):
//   - It REFUSES to run if the project already has ANY API Extension, so it can never
//     disturb a real one. Run it against a dedicated dev/sandbox project.
//   - Everything it creates is keyed under `il-localdev-` and DELETED on exit.
//   - `--cleanup` sweeps leftovers from a previous run that crashed before cleanup.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { Flags } from "@oclif/core";
import { context as esbuildContext, type BuildContext } from "esbuild";
import {
  buildBundle,
  defaultEntry,
  defaultOutfile,
  HOST_PROVIDED_EXTERNALS,
} from "../../../lib/tooling/build.js";
import { loadBundleSource, type EvaluatedBundle } from "../../../lib/tooling/loadBundle.js";
import { extractApiExtensions } from "../../../lib/tooling/apiExtensionDispatch.js";
import { createApiExtensionHandler } from "../../../lib/apiExtensionServer.js";
import type { ApiExtensionDefinition, ExtensionContext } from "../../../lib/tooling/apiExtension.js";
import {
  createExtension,
  ctApiBaseUrl,
  deleteExtension,
  draftFor,
  isManagedKey,
  listExtensions,
  managedKey,
  MANAGED_KEY_PREFIX,
  planReconcile,
  triggerSignature,
  type AuthFetch,
  type RegisteredExtension,
} from "../../../lib/ctExtensions.js";
import { extensionConfigFromEnv, extensionConfigFromPairs } from "../../../lib/extensionConfig.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class ExtensionServeApiExtension extends IntegrationLayerCommand {
  static override description =
    "Serve a bundle's API-Extension handlers locally and register a commercetools API Extension at them, so real writes hit your machine for end-to-end debugging";

  static override examples = [
    "<%= config.bin %> integration-layer extension serve-api-extension --public-url https://abc123.ngrok.app",
    "<%= config.bin %> integration-layer extension serve-api-extension --public-url https://abc123.ngrok.app --port 4000 --config MAX_LINE_QUANTITY=10",
    "<%= config.bin %> integration-layer extension serve-api-extension --cleanup",
  ];

  static override flags = {
    "public-url": Flags.string({
      description:
        "the PUBLIC https base URL of a tunnel to this machine (e.g. from `ngrok http <port>`); commercetools calls `<public-url>/api-extensions`",
    }),
    port: Flags.integer({ char: "p", description: "local port to listen on", default: 4000 }),
    secret: Flags.string({
      description:
        "shared secret commercetools must present on the callback (also settable via IL_DEBUG_EXT_SECRET); a random one is minted per run if omitted",
      env: "IL_DEBUG_EXT_SECRET",
    }),
    entry: Flags.string({ description: "extension entry source file", default: defaultEntry() }),
    out: Flags.string({ description: "bundle output file", default: defaultOutfile() }),
    config: Flags.string({
      description:
        "a ctx.config entry as KEY=VALUE (repeatable); overrides EXTENSION_CONFIG_* from the environment / .env",
      multiple: true,
      delimiter: ",",
    }),
    cleanup: Flags.boolean({
      description:
        "remove any leftover `il-localdev-*` API Extensions from a previous run and exit (does not serve)",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionServeApiExtension);
    const principal = this.requirePrincipal();
    const projectKey = flags["project-key"] ?? principal.getProjectKey();
    if (!projectKey) {
      this.error(
        "no project key — log in with `commercetools auth login --project-key <key>` or pass --project-key",
      );
    }
    const apiBaseUrl = ctApiBaseUrl(principal.getRegion());
    const authFetch = this.authFetch;

    if (flags.cleanup) {
      await this.cleanupLeftovers(apiBaseUrl, projectKey, authFetch);
      return;
    }

    const publicUrl = flags["public-url"]?.replace(/\/+$/, "");
    if (!publicUrl) {
      this.error(
        "--public-url is required: start a tunnel to this machine (e.g. `ngrok http " +
          `${flags.port}\`) and pass its https address`,
      );
    }
    let parsedPublic: URL;
    try {
      parsedPublic = new URL(publicUrl);
    } catch {
      this.error(`--public-url is not a valid URL: ${publicUrl}`);
    }
    if (parsedPublic.protocol !== "https:") {
      this.warn(
        `--public-url is not https (${parsedPublic.protocol}) — commercetools requires a reachable HTTPS destination in most projects`,
      );
    }
    const callbackUrl = `${publicUrl}/api-extensions`;

    // Refuse to touch a project that already has Extensions (see the SAFETY MODEL note).
    const existing = await listExtensions(apiBaseUrl, projectKey, authFetch);
    if (existing.length > 0) {
      const keys = existing.map((e) => e.key ?? "(no key)").join(", ");
      const hint = existing.some((e) => isManagedKey(e.key))
        ? " Some look like leftovers from a previous run — clear them with `--cleanup`."
        : "";
      this.error(
        `project '${projectKey}' already has ${existing.length} API Extension(s): ${keys}. ` +
          "Refusing to register — this command only runs against a project with none, so it can " +
          `never disturb an existing Extension.${hint}`,
      );
    }

    // ctx.config from EXTENSION_CONFIG_* / .env, with explicit --config winning (there
    // is no Commerce Integration Layer to read the project's stored config from).
    const config = {
      ...extensionConfigFromEnv(),
      ...extensionConfigFromPairs(flags.config ?? []),
    };
    const makeCtx = (): ExtensionContext => ({ now: () => Date.now(), config });

    // Initial one-shot build so we can validate the bundle declares handlers and
    // register them BEFORE opening a port — fail fast otherwise.
    let current = await this.buildOnce(flags.entry, flags.out);
    if (current.length === 0) {
      this.error(
        "this bundle declares no `apiExtensions` — nothing to serve (author them with `defineApiExtension`)",
      );
    }

    const secret = flags.secret ?? randomBytes(24).toString("hex");
    const headerValue = `Bearer ${secret}`;

    // Start listening BEFORE registering, so the destination is live the instant
    // commercetools learns about it.
    const registered: RegisteredExtension[] = [];
    const server = createServer(
      createApiExtensionHandler({
        secret,
        makeCtx,
        handlers: () => current,
        onDispatch: (summary) => this.log(`→ ${summary}`),
        onError: (err) => this.warn(`handler threw: ${err.message}`),
      }),
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(flags.port, resolve);
    }).catch((err: Error) => this.error(`could not listen on port ${flags.port}: ${err.message}`));

    await this.reconcile(apiBaseUrl, projectKey, authFetch, callbackUrl, headerValue, registered, current);

    // Hot-reload: rebuild on every source edit, swap the live handlers, and reconcile
    // the registered Extensions if the trigger shapes changed (a handler-body edit
    // needs no commercetools round trip).
    const watchCtx = await this.watchEntry(flags.entry, flags.out, async (mod) => {
      const next = extractApiExtensions(mod);
      if (next.length === 0) {
        this.warn("reloaded bundle declares no `apiExtensions` — keeping the previous handlers");
        return;
      }
      current = next;
      try {
        await this.reconcile(apiBaseUrl, projectKey, authFetch, callbackUrl, headerValue, registered, current);
      } catch (err) {
        this.warn(`could not update registered Extensions: ${(err as Error).message}`);
      }
      this.log(`✓ reloaded ${flags.entry}`);
    });

    this.log(
      [
        `\n🔌 API-Extension debug server for '${projectKey}' live:`,
        `   local     http://localhost:${flags.port}/api-extensions`,
        `   public    ${callbackUrl}`,
        `   handlers  ${current.map((h) => `${h.key} (${h.resourceTypeId}/${h.actions.join(",")})`).join(", ")}`,
        `   secret    commercetools authenticates with a per-run bearer (${flags.secret ? "from --secret/IL_DEBUG_EXT_SECRET" : "randomly minted"})`,
        `   watching  ${flags.entry} — edit and save to hot-reload`,
        "   do a matching cart/order write in the project; Ctrl-C to deregister and exit\n",
      ].join("\n"),
    );

    let shuttingDown = false;
    const shutdown = async (): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      this.log("\nDeregistering API Extensions and shutting down …");
      await this.cleanupLeftovers(apiBaseUrl, projectKey, authFetch).catch((err: Error) =>
        this.warn(
          `could not remove every registered Extension (${err.message}) — run \`--cleanup\` to finish`,
        ),
      );
      await watchCtx.dispose().catch(() => {});
      server.close(() => process.exit(0));
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());

    // Keep the process alive; the server + esbuild watcher run until a signal.
    await new Promise<void>(() => {});
  }

  /** Apply {@link planReconcile}: delete superseded/removed Extensions, create new ones. */
  private async reconcile(
    apiBaseUrl: string,
    projectKey: string,
    authFetch: AuthFetch,
    callbackUrl: string,
    headerValue: string,
    registered: RegisteredExtension[],
    desired: ApiExtensionDefinition[],
  ): Promise<void> {
    const plan = planReconcile(registered, desired);
    for (const reg of plan.toDelete) {
      await deleteExtension(apiBaseUrl, projectKey, authFetch, reg.id, reg.version);
      const idx = registered.findIndex((r) => r.authorKey === reg.authorKey && r.id === reg.id);
      if (idx >= 0) registered.splice(idx, 1);
      this.log(`  − deregistered '${managedKey(reg.authorKey)}'`);
    }
    for (const decl of plan.toCreate) {
      const created = await createExtension(
        apiBaseUrl,
        projectKey,
        authFetch,
        draftFor(decl, callbackUrl, headerValue),
      );
      const entry: RegisteredExtension = {
        authorKey: decl.key,
        id: created.id,
        version: created.version,
        signature: triggerSignature(decl),
      };
      const idx = registered.findIndex((r) => r.authorKey === decl.key);
      if (idx >= 0) registered[idx] = entry;
      else registered.push(entry);
      this.log(
        `  + registered '${created.key ?? managedKey(decl.key)}' → ${callbackUrl} (${decl.resourceTypeId}/${decl.actions.join(",")})`,
      );
    }
  }

  /** Delete every `il-localdev-*` Extension currently on the project (best-effort). */
  private async cleanupLeftovers(
    apiBaseUrl: string,
    projectKey: string,
    authFetch: AuthFetch,
  ): Promise<void> {
    const managed = (await listExtensions(apiBaseUrl, projectKey, authFetch)).filter((e) =>
      isManagedKey(e.key),
    );
    if (managed.length === 0) {
      this.log(`No \`${MANAGED_KEY_PREFIX}*\` API Extensions to remove on '${projectKey}'.`);
      return;
    }
    for (const e of managed) {
      try {
        await deleteExtension(apiBaseUrl, projectKey, authFetch, e.id, e.version);
        this.log(`  − removed '${e.key}'`);
      } catch (err) {
        this.warn(`could not remove '${e.key}': ${(err as Error).message}`);
      }
    }
  }

  /** One-shot build + load; returns the bundle's declared handlers. */
  private async buildOnce(entry: string, outfile: string): Promise<ApiExtensionDefinition[]> {
    await buildBundle(entry, outfile);
    return extractApiExtensions(loadBundleSource(await readFile(outfile, "utf8")));
  }

  /**
   * esbuild-watch `entry`; on every successful (re)build load the bundle and hand the
   * raw module to `onReload`. Resolves once the first build completes. Mirrors the
   * `serve` command's watcher, with the same bundle options as `buildBundle`.
   */
  private async watchEntry(
    entry: string,
    outfile: string,
    onReload: (mod: EvaluatedBundle) => void | Promise<void>,
  ): Promise<BuildContext> {
    const warn = (m: string): void => {
      this.warn(m);
    };
    let firstBuildDone!: () => void;
    const firstBuild = new Promise<void>((resolve) => {
      firstBuildDone = resolve;
    });
    let isFirstBuild = true;

    const ctx = await esbuildContext({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "cjs",
      platform: "neutral",
      target: "node22",
      conditions: ["worker"],
      mainFields: ["module", "main"],
      external: HOST_PROVIDED_EXTERNALS,
      logLevel: "silent",
      plugins: [
        {
          name: "il-serve-api-extension-reload",
          setup(build) {
            build.onEnd(async (result) => {
              try {
                if (result.errors.length > 0) {
                  warn("✗ build failed — fix the error and save again");
                  for (const e of result.errors) warn(`  ${e.text}`);
                  return;
                }
                // Skip the very first build's reload: the caller already loaded the
                // one-shot build and reconciled from it, so re-running would be a no-op.
                if (isFirstBuild) return;
                try {
                  await onReload(loadBundleSource(await readFile(outfile, "utf8")));
                } catch (err) {
                  warn(`✗ reload failed: ${(err as Error).message}`);
                }
              } finally {
                if (isFirstBuild) {
                  isFirstBuild = false;
                  firstBuildDone();
                }
              }
            });
          },
        },
      ],
    });

    await ctx.watch();
    await firstBuild;
    return ctx;
  }
}
