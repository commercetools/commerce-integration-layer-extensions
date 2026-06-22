// `ee-ext serve` — run the current example as a live, queryable GraphQL server on
// localhost, the inner dev loop the build/validate/push flow lacked. It builds the
// bundle, loads it, serves an Apollo Federation v2 subgraph from its `typeDefs` +
// `resolvers`, and invokes them with the capability `ctx` (here `ctx.config` comes
// from `EXTENSION_CONFIG_*` env vars). esbuild watches the source: edit and the served
// schema(s) hot-swap with no restart.
//
// Modes:
//   ee-ext serve              standalone: the extension subgraph at /graphql.
//   ee-ext serve --compose    + the merged schema (extension + integration layer),
//                             browsable at /composed (and as SDL — see below).
//   ee-ext serve --gateway    /graphql becomes an executable federated gateway over
//                             the local extension + deployed integration layer.
// `--compose`/`--gateway` need the shared `.env` (INTEGRATION_LAYER_URL +
// CTP_PROJECT_KEY); `--gateway` also mints an anonymous session for its calls.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { parse, type GraphQLSchema } from "graphql";
import { createYoga } from "graphql-yoga";
import { useApolloFederation } from "@envelop/apollo-federation";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { context as esbuildContext, type BuildContext } from "esbuild";
import { defaultEntry, defaultOutfile, HOST_PROVIDED_EXTERNALS } from "./build.js";
import { loadBundleSource, type EvaluatedBundle } from "./loadBundle.js";
import { loadProjectEnv } from "./env.js";
import { required } from "./ctToken.js";
import {
  composeWithIntegrationLayer,
  fetchIntegrationLayerSubgraphSdl,
  type ComposeResult,
} from "./compose.js";
import { makeGateway, mintAnonymousSession } from "./gateway.js";

/** The host-mediated capability context the runtime passes a resolver (3rd arg). */
export interface ExtensionContext {
  now(): number;
  /** Per-project configuration the runtime injects (see `devConfigFromEnv`). */
  config: Readonly<Record<string, string>>;
}

/**
 * Per-project config the runtime injects as `ctx.config`. Locally there is no
 * integration layer to read it from, so it's sourced from `EXTENSION_CONFIG_<KEY>`
 * env vars — e.g. `EXTENSION_CONFIG_ALGOLIA_API_KEY=…` becomes `ctx.config.ALGOLIA_API_KEY`.
 */
export function devConfigFromEnv(): Readonly<Record<string, string>> {
  const prefix = "EXTENSION_CONFIG_";
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && typeof value === "string") {
      config[key.slice(prefix.length)] = value;
    }
  }
  return config;
}

/**
 * The dev capability context (`ctx`). Outbound HTTP is not here — the resolver (or its
 * SDK) calls the global `fetch`. `config` comes from `EXTENSION_CONFIG_*` env vars.
 */
export function devContext(): ExtensionContext {
  return {
    now: () => Date.now(),
    config: devConfigFromEnv(),
  };
}

export interface ServeOptions {
  port: number;
  /** Layer the full merged (extension + integration layer) schema in, at /composed. */
  compose: boolean;
  /** Make /graphql an executable federated gateway over the extension + integration layer. */
  gateway: boolean;
}

/** Parse `serve` flags: `--port N`/`-p N`/`--port=N`, `--compose`, `--gateway`. */
export function parseServeOptions(argv: string[]): ServeOptions {
  let port = 4000;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") {
      const value = Number(argv[i + 1]);
      if (Number.isInteger(value) && value > 0) port = value;
    }
    const eq = arg?.match(/^--port=(\d+)$/);
    if (eq) port = Number(eq[1]);
  }
  return { port, compose: argv.includes("--compose"), gateway: argv.includes("--gateway") };
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
function buildSubgraph(mod: EvaluatedBundle): BuiltSubgraph {
  const { typeDefs, resolvers } = mod;
  if (typeof typeDefs !== "string" || typeDefs.trim() === "") {
    throw new Error("bundle must export a non-empty `typeDefs` string");
  }
  if (resolvers === null || typeof resolvers !== "object") {
    throw new Error("bundle must export a `resolvers` object");
  }
  // `@apollo/subgraph` types `resolvers` as its internal `GraphQLResolverMap`; the
  // bundle's exports are `unknown` (validated above), so cast through the function's
  // own parameter type rather than reaching into its `dist/` internals.
  const moduleArg = { typeDefs: parse(typeDefs), resolvers } as unknown as Parameters<
    typeof buildSubgraphSchema
  >[0];
  return { schema: buildSubgraphSchema(moduleArg), typeDefs };
}

/**
 * Start esbuild in watch mode over the current example and feed `onBuild` a freshly
 * loaded subgraph on every (re)build. Resolves once the initial build has produced
 * one (so the caller can start serving); later rebuilds fire `onBuild` again. Returns
 * the esbuild context so the caller can dispose it.
 */
async function watchAndBuild(
  entry: string,
  outfile: string,
  onBuild: (built: BuiltSubgraph) => void | Promise<void>,
): Promise<BuildContext> {
  const reload = async (): Promise<void> => {
    const source = await readFile(outfile, "utf8");
    // Re-evaluate the freshly-built bundle, mirroring a runtime reload.
    const mod = loadBundleSource(source);
    await onBuild(buildSubgraph(mod));
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
    // Resolve a bundled SDK to its `fetch`/`worker` build (which uses the global
    // `fetch`) rather than a Node `http`/`https` one — see build.ts.
    conditions: ["worker"],
    external: HOST_PROVIDED_EXTERNALS,
    logLevel: "silent",
    plugins: [
      {
        name: "ee-serve-reload",
        setup(build) {
          build.onEnd(async (result) => {
            try {
              if (result.errors.length > 0) {
                process.stderr.write(`✗ build failed — fix the error and save again\n`);
                for (const e of result.errors) process.stderr.write(`  ${e.text}\n`);
                return;
              }
              try {
                await reload();
                process.stdout.write(`✓ ${isFirstBuild ? "built" : "reloaded"} ${entry}\n`);
              } catch (err) {
                process.stderr.write(`✗ reload failed: ${(err as Error).message}\n`);
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

  // `watch()` performs the initial build (firing `onEnd`) and keeps rebuilding on
  // edits — so a single build path drives both startup and hot-reload.
  await ctx.watch();
  await firstBuild;
  return ctx;
}

/** Print composition errors as an indented list under a one-line headline. */
function reportComposeErrors(errors: string[]): void {
  process.stderr.write(`✗ does not compose with the integration layer:\n`);
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
}

/** `ee-ext serve [--compose]` — serve the current example on localhost. */
export async function serveCommand(): Promise<void> {
  const opts = parseServeOptions(process.argv.slice(3));
  const entry = defaultEntry();
  const outfile = defaultOutfile();
  const { port } = opts;
  // In gateway mode /graphql is the gateway, so the raw extension subgraph moves to an
  // internal path the gateway reaches over HTTP. Otherwise /graphql is the subgraph.
  const subgraphPath = opts.gateway ? "/_extension" : "/graphql";
  const extensionUrl = `http://localhost:${port}${subgraphPath}`;

  // --compose/--gateway fetch the integration-layer SDL once up front; --gateway also
  // mints an anonymous session so its integration-layer calls authenticate.
  const withIntegrationLayer = opts.compose || opts.gateway;
  let integrationLayerSdl: string | undefined;
  let integrationLayerGraphqlUrl = "";
  let integrationLayerBearer: string | undefined;
  if (withIntegrationLayer) {
    loadProjectEnv();
    const integrationLayerUrl = required("INTEGRATION_LAYER_URL").replace(/\/+$/, "");
    const projectKey = required("CTP_PROJECT_KEY");
    integrationLayerGraphqlUrl = `${integrationLayerUrl}/api/${encodeURIComponent(projectKey)}/graphql`;
    process.stdout.write(
      `Fetching integration-layer subgraph SDL for '${projectKey}' from ${integrationLayerUrl} …\n`,
    );
    integrationLayerSdl = await fetchIntegrationLayerSubgraphSdl(integrationLayerUrl, projectKey);
    if (opts.gateway) {
      integrationLayerBearer = await mintAnonymousSession(integrationLayerUrl, projectKey);
      process.stdout.write(`Minted an anonymous session for the gateway.\n`);
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

  const ctx = await watchAndBuild(entry, outfile, async (built) => {
    subgraphSchema = built.schema;
    if (!withIntegrationLayer) return;
    composed = composeWithIntegrationLayer(integrationLayerSdl!, built.typeDefs, {
      integrationLayerUrl: integrationLayerGraphqlUrl,
      extensionUrl,
    });
    if (!composed.ok) {
      reportComposeErrors(composed.errors);
      return;
    }
    process.stdout.write(
      `✓ composes with the integration layer — full schema at http://localhost:${port}/composed\n`,
    );
    if (!opts.gateway) return;

    if (composed.supergraphSdl === gatewaySupergraphSdl) {
      // SDL unchanged (resolver-only edit) — /_extension hot-reload covers it.
      process.stdout.write(`  (gateway plan unchanged — extension reloaded in place)\n`);
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
      });
      process.stdout.write(`✓ gateway ready at http://localhost:${port}/graphql\n`);
      if (prev) await prev.stop();
    } catch (err) {
      process.stderr.write(`✗ gateway build failed: ${(err as Error).message}\n`);
    }
  });

  if (!subgraphSchema) {
    await ctx.dispose();
    throw new Error("initial build did not produce a valid subgraph (see errors above)");
  }
  if (withIntegrationLayer && !composed?.ok) {
    process.stderr.write(
      opts.gateway
        ? "⚠ extension does not compose with the integration layer yet — the gateway is unavailable " +
            "until it does; fix the errors above and save to recompose.\n"
        : "⚠ extension does not compose with the integration layer yet — serving the standalone " +
            "subgraph; fix the errors above and save to recompose.\n",
    );
  }

  // The raw extension subgraph (executable). At /graphql normally, or the internal
  // /_extension when the gateway owns /graphql.
  const subgraphYoga = createYoga({
    schema: () => subgraphSchema!,
    context: () => devContext(),
    graphqlEndpoint: subgraphPath,
    landingPage: false,
  });

  // The composed, client-facing merged schema — browsable/introspectable, not
  // executable (no resolvers): "what the full schema looks like" to a consumer.
  // Available in both --compose and --gateway.
  const composedYoga = withIntegrationLayer
    ? createYoga({
        schema: () => {
          if (!composed?.ok) {
            throw new Error(
              `extension does not compose with the integration layer:\n${(composed?.errors ?? []).join("\n")}`,
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
        res.end(`extension does not compose with the integration layer:\n${(composed?.errors ?? []).join("\n")}\n`);
        return;
      }
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(path === "/schema.graphql" ? composed.apiSdl : composed.supergraphSdl);
      return;
    }

    if (composedYoga && path.startsWith("/composed")) return void composedYoga(req, res);
    if (opts.gateway && path.startsWith("/graphql")) {
      if (!gatewayYoga) {
        const errs = composed && !composed.ok ? composed.errors : [];
        res.statusCode = 503;
        res.setHeader("content-type", "text/plain");
        res.end(`gateway not ready — extension does not compose with the integration layer:\n${errs.join("\n")}\n`);
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
    opts.gateway
      ? `   ${base}/graphql   — FEDERATED gateway (local extension + deployed integration layer)`
      : `   ${base}/graphql   — extension subgraph`,
  );
  if (opts.gateway) lines.push(`   ${base}/_extension — the raw extension subgraph (gateway routes to it)`);
  if (withIntegrationLayer) {
    lines.push(`   ${base}/composed  — full merged schema (browsable; not executable)`);
    lines.push(`   ${base}/schema.graphql, ${base}/supergraph.graphql — SDL (text)`);
  }
  lines.push(`   open ${base}/graphql in a browser for GraphiQL`);
  lines.push(`   watching ${entry} — edit and save to hot-reload\n`);
  process.stdout.write(lines.join("\n") + "\n");

  const shutdown = (): void => {
    void ctx.dispose();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
