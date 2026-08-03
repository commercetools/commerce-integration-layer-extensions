// Local dev server for an extension — the inner loop the build/validate/push flow
// lacks. It builds the bundle, loads it, serves an Apollo Federation v2 subgraph from
// its `typeDefs` + `resolvers`, and esbuild watches the source so an edit hot-swaps
// the served schema with no restart. The command wrapper is ours; the schema
// composition / gateway / SDL-fetch building blocks are the copied low-level tooling
// functions (compose.ts, gateway.ts, ilClient.fetchSubgraphSdl).
//
// Modes:
//   serve              standalone: the extension subgraph at /graphql.
//   serve --compose    + the merged schema (extension + Commerce Integration Layer) at /composed.
//   serve --gateway    /graphql becomes an executable federated gateway over the
//                       local extension + the deployed Commerce Integration Layer.
// --compose/--gateway reach the Commerce Integration Layer, so they need the auth flags/env
// (ilFlags); --gateway also mints an anonymous session for its calls.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { Flags } from "@oclif/core";
import { parse, type GraphQLSchema } from "graphql";
import { createYoga } from "graphql-yoga";
import { useApolloFederation } from "@envelop/apollo-federation";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { context as esbuildContext, type BuildContext } from "esbuild";
import { defaultEntry, defaultOutfile, HOST_PROVIDED_EXTERNALS } from "../../../lib/tooling/build.js";
import { loadBundleSource, type EvaluatedBundle } from "../../../lib/tooling/loadBundle.js";
import { composeWithIntegrationLayer, type ComposeResult } from "../../../lib/tooling/compose.js";
import { discoverExtensions, mergeExtensionSubgraph } from "../../../lib/tooling/extensions.js";
import { makeGateway, mintAnonymousSession } from "../../../lib/tooling/gateway.js";
import { fetchSubgraphSdl, getAllowlist } from "../../../lib/ilClient.js";
import {
  IntegrationLayerCommand,
  authEdgeUrlForRegion,
  type IlContext,
  type IlFlagValues,
} from "../../../lib/base.js";
import {
  createSandboxFetch,
  installDelegatingFetch,
  wrapResolverMap,
} from "../../../lib/tooling/sandboxFetch.js";

/** The host-mediated capability context the runtime passes a resolver (3rd arg). */
interface ExtensionContext {
  now(): number;
  config: Readonly<Record<string, string>>;
}

/**
 * Per-project config the runtime injects as `ctx.config`. Locally there is no
 * Commerce Integration Layer to read it from, so it's sourced from `EXTENSION_CONFIG_<KEY>`
 * env vars — e.g. `EXTENSION_CONFIG_ALGOLIA_API_KEY=…` becomes `ctx.config.ALGOLIA_API_KEY`.
 */
function devConfigFromEnv(): Readonly<Record<string, string>> {
  const prefix = "EXTENSION_CONFIG_";
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && typeof value === "string") {
      config[key.slice(prefix.length)] = value;
    }
  }
  return config;
}

function devContext(): ExtensionContext {
  return { now: () => Date.now(), config: devConfigFromEnv() };
}

/** The loaded bundle's federation subgraph schema plus its raw SDL. */
interface BuiltSubgraph {
  schema: GraphQLSchema;
  typeDefs: string;
}

/**
 * Build a federation subgraph schema from the loaded bundle, the same way the runtime
 * does. Throws (with a clean message) if the bundle didn't export a `typeDefs` string
 * + `resolvers` object — the same shape `validateBundle` checks.
 */
function buildSubgraph(mod: EvaluatedBundle, sandboxFetch?: typeof fetch): BuiltSubgraph {
  const { typeDefs, resolvers } = mod;
  if (typeof typeDefs !== "string" || typeDefs.trim() === "") {
    throw new Error("bundle must export a non-empty `typeDefs` string");
  }
  if (resolvers === null || typeof resolvers !== "object") {
    throw new Error("bundle must export a `resolvers` object");
  }
  const resolvedResolvers = sandboxFetch ? wrapResolverMap(resolvers, sandboxFetch) : resolvers;
  // `@apollo/subgraph` types `resolvers` as its internal `GraphQLResolverMap`; the
  // bundle's exports are `unknown` (validated above), so cast through the function's
  // own parameter type rather than reaching into its `dist/` internals.
  const moduleArg = { typeDefs: parse(typeDefs), resolvers: resolvedResolvers } as unknown as Parameters<
    typeof buildSubgraphSchema
  >[0];
  return { schema: buildSubgraphSchema(moduleArg), typeDefs };
}

export default class ExtensionServe extends IntegrationLayerCommand {
  static override description =
    "Run a local dev server for the extension (subgraph, or a composed/federated gateway)";

  static override examples = [
    "<%= config.bin %> integration-layer extension serve",
    "<%= config.bin %> integration-layer extension serve --compose",
    "<%= config.bin %> integration-layer extension serve --gateway --port 4000",
  ];

  // Standalone serve needs no login; --compose/--gateway resolve the context lazily
  // (and then require a logged-in principal) only when they actually reach the IL.
  // The HTTP allowlist is fetched best-effort when logged in and online.
  protected override authorized = false;

  static override flags = {
    port: Flags.integer({ char: "p", description: "port to listen on", default: 4000 }),
    compose: Flags.boolean({
      description: "also serve the merged (extension + Commerce Integration Layer) schema at /composed",
      default: false,
    }),
    gateway: Flags.boolean({
      description: "make /graphql an executable federated gateway over both subgraphs",
      default: false,
    }),
    all: Flags.boolean({
      description:
        "merge every extension under ./extensions/* into ONE subgraph (the single deployed bundle) and serve it behind a local federated gateway with the Commerce Integration Layer",
      default: false,
    }),
    "extensions-dir": Flags.string({
      description: "directory holding the extension packages (used with --all)",
      default: "extensions",
    }),
    "auth-url": Flags.string({
      description:
        "identity edge base URL, where --gateway/--all mint their session and reach the core-subgraph /graphql (also settable via IL_AUTH_URL); overrides the URL derived from your login region",
      env: "IL_AUTH_URL",
      helpGroup: "COMMERCE INTEGRATION LAYER",
    }),
  };

  /**
   * The identity/storefront edge (the `auth.` host) — where `--gateway`/`--all` mint the
   * anonymous session AND reach the Commerce Integration Layer's CORE subgraph `/graphql`. Both are
   * served by the identity edge, a DIFFERENT host from the extensions edge
   * ({@link IlContext.baseUrl}, `extensions.`, which serves `/subgraph`). The gateway must
   * route to the core subgraph here, NOT the `graphql.` router edge, whose COMPOSED graph
   * would double-count the local extension. Overridable via --auth-url / IL_AUTH_URL for
   * staging zones that don't follow the production host convention.
   */
  private warnUnrestrictedResolverFetch(reason: string): void {
    this.logToStderr(
      `⚠ ${reason} — resolver fetch is UNRESTRICTED locally (production still enforces the project allowlist)`,
    );
  }

  /**
   * Load the project's extension HTTP allowlist when logged in and the integration layer
   * is reachable. Returns undefined (after a warning) when not logged in or offline.
   */
  private async trySandboxFetch(
    flags: IlFlagValues,
    ctx?: IlContext,
  ): Promise<typeof fetch | undefined> {
    let ilContext = ctx;
    if (!ilContext) {
      try {
        ilContext = await this.resolveIlContext(flags);
      } catch (err) {
        this.warnUnrestrictedResolverFetch((err as Error).message);
        return undefined;
      }
    }
    try {
      const { allow } = await getAllowlist(
        ilContext.baseUrl,
        ilContext.projectKey,
        ilContext.token,
      );
      if (allow.length === 0) {
        this.log(
          `⚠ extension HTTP allowlist for '${ilContext.projectKey}' is empty — resolver fetch can reach only localhost until hosts are added (commercetools integration-layer allowlist add …)`,
        );
      } else {
        this.log(`Extension HTTP allowlist for '${ilContext.projectKey}': ${allow.join(", ")}`);
      }
      return createSandboxFetch(() => allow);
    } catch (err) {
      this.warnUnrestrictedResolverFetch(
        `could not load the extension HTTP allowlist (${(err as Error).message})`,
      );
      return undefined;
    }
  }

  private maybeWrapResolvers(resolvers: object, sandboxFetch: typeof fetch | undefined): object {
    return sandboxFetch ? wrapResolverMap(resolvers, sandboxFetch) : resolvers;
  }

  private resolveAuthEdge(flags: { "auth-url"?: string }): string {
    const authUrl = flags["auth-url"] ?? authEdgeUrlForRegion(this.requirePrincipal().getRegion());
    if (!authUrl) {
      throw new Error(
        "could not resolve the identity edge URL: pass --auth-url or set IL_AUTH_URL " +
          "(e.g. https://auth.integration-layer.eu-central-1.aws.commercetools.com)",
      );
    }
    return authUrl.replace(/\/+$/, "");
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ExtensionServe);
    if (flags.all) {
      await this.runAll(flags);
      return;
    }
    const sandboxFetch = await this.trySandboxFetch(flags);
    const restoreFetch = sandboxFetch ? installDelegatingFetch() : undefined;

    const entry = defaultEntry();
    const outfile = defaultOutfile();
    const port = flags.port;
    // In gateway mode /graphql is the gateway, so the raw extension subgraph moves to
    // an internal path the gateway reaches over HTTP. Otherwise /graphql is the subgraph.
    const subgraphPath = flags.gateway ? "/_extension" : "/graphql";
    const extensionUrl = `http://localhost:${port}${subgraphPath}`;

    // --compose/--gateway fetch the integration-layer SDL once up front; --gateway
    // also mints an anonymous session so its integration-layer calls authenticate.
    const withIntegrationLayer = flags.compose || flags.gateway;
    let integrationLayerSdl: string | undefined;
    let integrationLayerGraphqlUrl = "";
    let integrationLayerBearer: string | undefined;
    if (withIntegrationLayer) {
      const { baseUrl, projectKey, token } = await this.resolveIlContext(flags);
      // /subgraph is on the extensions edge (baseUrl); the core-subgraph /graphql the
      // gateway routes to and the /session it mints are on the identity edge, reached via
      // the identity/auth edge — a different host in the deployed split (see resolveAuthEdge).
      const authUrl = this.resolveAuthEdge(flags);
      integrationLayerGraphqlUrl = `${authUrl}/${encodeURIComponent(projectKey)}/graphql`;
      this.log(`Fetching integration-layer subgraph SDL for '${projectKey}' from ${baseUrl} …`);
      integrationLayerSdl = await fetchSubgraphSdl(baseUrl, projectKey, token);
      if (flags.gateway) {
        integrationLayerBearer = await mintAnonymousSession(authUrl, projectKey);
        this.log("Minted an anonymous session for the gateway.");
      }
    }

    // Served-schema state, hot-swapped on each rebuild. The yoga factories/dispatcher
    // below close over these, so a reload is picked up with no restart.
    let subgraphSchema: GraphQLSchema | undefined;
    let composed: ComposeResult | undefined;
    // The gateway yoga handler + the supergraph it was built for. We only rebuild the
    // (expensive) gateway when the supergraph SDL changes; a resolver-only edit is
    // covered by the /_extension hot-reload alone. On a failed recompile we keep the
    // last good gateway serving and log the errors.
    let gatewayYoga: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;
    let gatewaySupergraphSdl: string | undefined;
    let apolloGateway: { stop(): Promise<void> } | undefined;

    const log = (m: string): void => this.log(m);
    const warn = (m: string): void => {
      this.logToStderr(m);
    };

    const ctx = await this.watchAndBuild(entry, outfile, sandboxFetch, async (built) => {
      subgraphSchema = built.schema;
      if (!withIntegrationLayer) return;
      composed = composeWithIntegrationLayer(integrationLayerSdl!, built.typeDefs, {
        integrationLayerUrl: integrationLayerGraphqlUrl,
        extensionUrl,
      });
      if (!composed.ok) {
        warn("✗ does not compose with the Commerce Integration Layer:");
        for (const e of composed.errors) warn(`  - ${e}`);
        return;
      }
      log(`✓ composes with the Commerce Integration Layer — full schema at http://localhost:${port}/composed`);
      if (!flags.gateway) return;

      if (composed.supergraphSdl === gatewaySupergraphSdl) {
        log("  (gateway plan unchanged — extension reloaded in place)");
        return;
      }
      try {
        const gw = await makeGateway({
          supergraphSdl: composed.supergraphSdl,
          integrationLayerBearer: integrationLayerBearer!,
        });
        const prev = apolloGateway;
        apolloGateway = gw;
        gatewaySupergraphSdl = composed.supergraphSdl;
        gatewayYoga = createYoga({
          plugins: [useApolloFederation({ gateway: gw })],
          graphqlEndpoint: "/graphql",
          landingPage: false,
          maskedErrors: false,
        });
        log(`✓ gateway ready at http://localhost:${port}/graphql`);
        if (prev) await prev.stop();
      } catch (err) {
        warn(`✗ gateway build failed: ${(err as Error).message}`);
      }
    });

    if (!subgraphSchema) {
      await ctx.dispose();
      this.error("initial build did not produce a valid subgraph (see errors above)");
    }
    if (withIntegrationLayer && !composed?.ok) {
      warn(
        flags.gateway
          ? "⚠ extension does not compose with the Commerce Integration Layer yet — the gateway is " +
              "unavailable until it does; fix the errors above and save to recompose."
          : "⚠ extension does not compose with the Commerce Integration Layer yet — serving the " +
              "standalone subgraph; fix the errors above and save to recompose.",
      );
    }

    // The raw extension subgraph (executable). At /graphql normally, or the internal
    // /_extension when the gateway owns /graphql.
    const subgraphYoga = createYoga({
      schema: () => subgraphSchema!,
      context: () => devContext(),
      graphqlEndpoint: subgraphPath,
      landingPage: false,
      maskedErrors: false,
    });

    // The composed, client-facing merged schema — browsable/introspectable, not
    // executable (no resolvers). Available in both --compose and --gateway.
    const composedYoga = withIntegrationLayer
      ? createYoga({
          schema: () => {
            if (!composed?.ok) {
              throw new Error(
                `extension does not compose with the Commerce Integration Layer:\n${(composed?.errors ?? []).join("\n")}`,
              );
            }
            return composed.apiSchema;
          },
          graphqlEndpoint: "/composed",
          landingPage: false,
        })
      : undefined;

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const path = (req.url ?? "").split("?")[0];

      // Plain-text SDL endpoints (handy for `curl > schema.graphql`).
      if (req.method === "GET" && (path === "/schema.graphql" || path === "/supergraph.graphql")) {
        if (!composed?.ok) {
          res.statusCode = 503;
          res.setHeader("content-type", "text/plain");
          res.end(
            `extension does not compose with the Commerce Integration Layer:\n${(composed?.errors ?? []).join("\n")}\n`,
          );
          return;
        }
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(path === "/schema.graphql" ? composed.apiSdl : composed.supergraphSdl);
        return;
      }

      if (composedYoga && path.startsWith("/composed")) return void composedYoga(req, res);
      if (flags.gateway && path.startsWith("/graphql")) {
        if (!gatewayYoga) {
          const errs = composed && !composed.ok ? composed.errors : [];
          res.statusCode = 503;
          res.setHeader("content-type", "text/plain");
          res.end(
            `gateway not ready — extension does not compose with the Commerce Integration Layer:\n${errs.join("\n")}\n`,
          );
          return;
        }
        return void gatewayYoga(req, res);
      }
      // /_extension (gateway) or /graphql (standalone/compose).
      return void subgraphYoga(req, res);
    });
    await new Promise<void>((resolve) => server.listen(port, resolve));

    const base = `http://localhost:${port}`;
    const lines = [`\n🔌 ${entry} live:`];
    lines.push(
      flags.gateway
        ? `   ${base}/graphql   — FEDERATED gateway (local extension + deployed Commerce Integration Layer)`
        : `   ${base}/graphql   — extension subgraph`,
    );
    if (flags.gateway) lines.push(`   ${base}/_extension — the raw extension subgraph (gateway routes to it)`);
    if (withIntegrationLayer) {
      lines.push(`   ${base}/composed  — full merged schema (browsable; not executable)`);
      lines.push(`   ${base}/schema.graphql, ${base}/supergraph.graphql — SDL (text)`);
    }
    lines.push(`   open ${base}/graphql in a browser for GraphiQL`);
    lines.push(`   watching ${entry} — edit and save to hot-reload\n`);
    this.log(lines.join("\n"));

    const shutdown = (): void => {
      restoreFetch?.();
      void ctx.dispose();
      server.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep the process alive; the server + esbuild watcher run until a signal.
    await new Promise<void>(() => {});
  }

  /**
   * `--all`: merge every extension under `./extensions/*` into ONE federation subgraph —
   * the single bundle a project deploys — and serve it behind a local federated gateway
   * with the deployed Commerce Integration Layer, exactly the two-subgraph shape the router plans
   * over (core + the combined `extensions` subgraph). Like `--gateway` it reaches the
   * Commerce Integration Layer (fetches its SDL, mints an anonymous session), so it needs a
   * `commercetools auth login`. Watches every extension and hot-reloads: any edit
   * re-merges the combined subgraph, and a schema change recomposes + rebuilds the gateway.
   */
  private async runAll(
    flags: { port: number; "extensions-dir": string; "auth-url"?: string } & IlFlagValues,
  ): Promise<void> {
    const port = flags.port;
    const root = process.cwd();
    const extensions = await discoverExtensions(root, flags["extensions-dir"]);
    if (extensions.length === 0) {
      this.error(
        `no extensions found under ./${flags["extensions-dir"]}/*/src/extension.ts — run --all from the monorepo root`,
      );
    }

    const ilContext = await this.resolveIlContext(flags);
    const sandboxFetch = await this.trySandboxFetch(flags, ilContext);
    const restoreFetch = sandboxFetch ? installDelegatingFetch() : undefined;

    // Reach the Commerce Integration Layer exactly like --gateway: its core-subgraph SDL is the
    // compose baseline, and an anonymous session authenticates the gateway's calls.
    const { baseUrl, projectKey, token } = ilContext;
    // /subgraph is on the extensions edge (baseUrl); the core-subgraph /graphql the gateway
    // routes to and the /session it mints are on the identity edge, reached via the
    // identity/auth edge — a different host in the deployed split (see resolveAuthEdge).
    const authUrl = this.resolveAuthEdge(flags);
    const integrationLayerGraphqlUrl = `${authUrl}/${encodeURIComponent(projectKey)}/graphql`;
    this.log(`Fetching integration-layer subgraph SDL for '${projectKey}' from ${baseUrl} …`);
    const integrationLayerSdl = await fetchSubgraphSdl(baseUrl, projectKey, token);
    const integrationLayerBearer = await mintAnonymousSession(authUrl, projectKey);
    this.log("Minted an anonymous session for the gateway.");

    // The single combined-extensions subgraph endpoint — the gateway's one data source
    // besides the Commerce Integration Layer, named `extensions` just like the deployed bundle.
    const extensionUrl = `http://localhost:${port}/_extension`;

    // Per-extension loaded module (typeDefs + resolvers), merged into ONE subgraph on
    // each rebuild. The yoga factories/gateway close over these so a reload applies with
    // no restart.
    const modules = new Map<string, { typeDefs: string; resolvers: object }>();
    let combinedSchema: GraphQLSchema | undefined;
    let composed: ComposeResult | undefined;
    let gatewayYoga: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;
    let gatewaySupergraphSdl: string | undefined;
    let apolloGateway: { stop(): Promise<void> } | undefined;

    const log = (m: string): void => this.log(m);
    const warn = (m: string): void => this.logToStderr(m);

    // Merge all extensions into one subgraph, compose with the Commerce Integration Layer, and
    // (re)build the gateway when the supergraph changes. No-op until every extension has
    // produced its first build; a string-compare skips the gateway rebuild for a
    // resolver-only edit (the /_extension hot-reload alone covers it).
    const recompose = async (): Promise<void> => {
      if (modules.size < extensions.length) return;
      try {
        const merged = mergeExtensionSubgraph(
          [...modules].map(([name, m]) => ({ name, typeDefs: m.typeDefs, resolvers: m.resolvers })),
        );
        combinedSchema = merged.schema;
        composed = composeWithIntegrationLayer(integrationLayerSdl, merged.sdl, {
          integrationLayerUrl: integrationLayerGraphqlUrl,
          extensionUrl,
        });
      } catch (err) {
        warn(`✗ ${(err as Error).message}`);
        return;
      }
      if (!composed.ok) {
        warn("✗ extensions do not compose with the Commerce Integration Layer:");
        for (const e of composed.errors) warn(`  - ${e}`);
        return;
      }
      log(`✓ composes with the Commerce Integration Layer — full schema at http://localhost:${port}/composed`);
      if (composed.supergraphSdl === gatewaySupergraphSdl) {
        log("  (gateway plan unchanged — extension reloaded in place)");
        return;
      }
      try {
        const gw = await makeGateway({ supergraphSdl: composed.supergraphSdl, integrationLayerBearer });
        const prev = apolloGateway;
        apolloGateway = gw;
        gatewaySupergraphSdl = composed.supergraphSdl;
        gatewayYoga = createYoga({
          plugins: [useApolloFederation({ gateway: gw })],
          graphqlEndpoint: "/graphql",
          landingPage: false,
          maskedErrors: false,
        });
        log(`✓ gateway ready at http://localhost:${port}/graphql`);
        if (prev) await prev.stop();
      } catch (err) {
        warn(`✗ gateway build failed: ${(err as Error).message}`);
      }
    };

    // Watch + build each extension; awaiting sequentially means the last first-build
    // triggers the initial merge/compose. `recompose` fires again on every later rebuild.
    const contexts: BuildContext[] = [];
    for (const ext of extensions) {
      const ctx = await this.watchEntry(ext.entry, ext.outfile, async (mod) => {
        const { typeDefs, resolvers } = mod;
        if (typeof typeDefs !== "string" || typeDefs.trim() === "") {
          warn(`✗ extension '${ext.name}' exported no \`typeDefs\` string`);
          return;
        }
        if (resolvers === null || typeof resolvers !== "object") {
          warn(`✗ extension '${ext.name}' exported no \`resolvers\` object`);
          return;
        }
        modules.set(ext.name, {
          typeDefs,
          resolvers: this.maybeWrapResolvers(resolvers, sandboxFetch),
        });
        await recompose();
      });
      contexts.push(ctx);
    }

    if (!combinedSchema) {
      for (const ctx of contexts) await ctx.dispose();
      this.error("extensions did not merge into a subgraph (see errors above)");
    }
    if (composed && !composed.ok) {
      warn(
        "⚠ extensions do not compose with the Commerce Integration Layer yet — the gateway is " +
          "unavailable until they do; fix the errors above and save to recompose.",
      );
    }

    // The combined extensions subgraph (executable), at the internal /_extension the
    // gateway reaches over HTTP. `schema: () => …` re-reads the latest merge, so a
    // hot-reload applies with no restart.
    const subgraphYoga = createYoga({
      schema: () => combinedSchema!,
      context: () => devContext(),
      graphqlEndpoint: "/_extension",
      landingPage: false,
      maskedErrors: false,
    });

    // The browsable (not executable) merged API schema.
    const composedYoga = createYoga({
      schema: () => {
        if (!composed?.ok) {
          throw new Error(
            `extensions do not compose with the Commerce Integration Layer:\n${(composed?.errors ?? []).join("\n")}`,
          );
        }
        return composed.apiSchema;
      },
      graphqlEndpoint: "/composed",
      landingPage: false,
    });

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const path = (req.url ?? "").split("?")[0];

      if (req.method === "GET" && (path === "/schema.graphql" || path === "/supergraph.graphql")) {
        if (!composed?.ok) {
          res.statusCode = 503;
          res.setHeader("content-type", "text/plain");
          res.end(
            `extensions do not compose with the Commerce Integration Layer:\n${(composed?.errors ?? []).join("\n")}\n`,
          );
          return;
        }
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(path === "/schema.graphql" ? composed.apiSdl : composed.supergraphSdl);
        return;
      }

      if (path.startsWith("/composed")) return void composedYoga(req, res);

      if (path.startsWith("/graphql")) {
        if (!gatewayYoga) {
          const errs = composed && !composed.ok ? composed.errors : [];
          res.statusCode = 503;
          res.setHeader("content-type", "text/plain");
          res.end(
            `gateway not ready — extensions do not compose with the Commerce Integration Layer:\n${errs.join("\n")}\n`,
          );
          return;
        }
        return void gatewayYoga(req, res);
      }

      // /_extension — the combined extensions subgraph.
      return void subgraphYoga(req, res);
    });
    await new Promise<void>((resolve) => server.listen(port, resolve));

    const base = `http://localhost:${port}`;
    const names = extensions.map((e) => e.name).join(", ");
    const lines = [
      `\n🔌 ${extensions.length} extension(s) merged into one subgraph (${names}), live behind a federated gateway:`,
    ];
    lines.push(
      `   ${base}/graphql   — FEDERATED gateway (combined extensions + deployed Commerce Integration Layer)`,
    );
    lines.push(`   ${base}/_extension — the combined extensions subgraph (gateway routes to it)`);
    lines.push(`   ${base}/composed  — full merged schema (browsable; not executable)`);
    lines.push(`   ${base}/schema.graphql, ${base}/supergraph.graphql — SDL (text)`);
    lines.push(`   open ${base}/graphql in a browser for GraphiQL`);
    lines.push(`   watching ${extensions.length} extension(s) — edit and save to hot-reload\n`);
    this.log(lines.join("\n"));

    const shutdown = (): void => {
      restoreFetch?.();
      for (const ctx of contexts) void ctx.dispose();
      server.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep the process alive; the server + esbuild watchers run until a signal.
    await new Promise<void>(() => {});
  }

  /**
   * Start esbuild in watch mode over the current example and feed `onBuild` a freshly
   * loaded subgraph on every (re)build. Resolves once the initial build has produced
   * one (so the caller can start serving); later rebuilds fire `onBuild` again.
   */
  private async watchAndBuild(
    entry: string,
    outfile: string,
    sandboxFetch: typeof fetch | undefined,
    onBuild: (built: BuiltSubgraph) => void | Promise<void>,
  ): Promise<BuildContext> {
    return this.watchEntry(entry, outfile, async (mod) => {
      await onBuild(buildSubgraph(mod, sandboxFetch));
    });
  }

  /**
   * The generic watcher underneath {@link watchAndBuild}: esbuild-watch `entry`, and on
   * every successful (re)build load the bundle and hand the raw module to `onReload`.
   * `--all` uses this directly (it needs the module's resolvers to merge subgraphs);
   * single-mode wraps it to build one subgraph.
   */
  private async watchEntry(
    entry: string,
    outfile: string,
    onReload: (mod: EvaluatedBundle) => void | Promise<void>,
  ): Promise<BuildContext> {
    const reload = async (): Promise<void> => {
      const source = await readFile(outfile, "utf8");
      await onReload(loadBundleSource(source));
    };

    let firstBuildDone!: () => void;
    const firstBuild = new Promise<void>((resolve) => {
      firstBuildDone = resolve;
    });
    let isFirstBuild = true;
    const log = (m: string): void => this.log(m);
    const warn = (m: string): void => this.logToStderr(m);

    const ctx = await esbuildContext({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "cjs",
      platform: "neutral",
      target: "node22",
      conditions: ["worker"],
      external: HOST_PROVIDED_EXTERNALS,
      logLevel: "silent",
      plugins: [
        {
          name: "il-serve-reload",
          setup(build) {
            build.onEnd(async (result) => {
              try {
                if (result.errors.length > 0) {
                  warn("✗ build failed — fix the error and save again");
                  for (const e of result.errors) warn(`  ${e.text}`);
                  return;
                }
                try {
                  await reload();
                  log(`✓ ${isFirstBuild ? "built" : "reloaded"} ${entry}`);
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
