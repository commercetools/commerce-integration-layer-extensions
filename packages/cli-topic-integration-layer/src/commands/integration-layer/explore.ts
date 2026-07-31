// `integration-layer explore` — a local GraphQL explorer for your project.
//
// One command: it resolves the project's schema, mints a session from your existing
// login, serves GraphiQL on localhost, and proxies every operation to the deployed
// edge. No tokens to paste, no headers to hand-edit.
//
// It replaces two things that were removed: the Merchant Center console's operator
// GraphQL Explorer, and the router's `/{project}/graphiql` + `x-developer-mode`
// introspection gate. The edge now runs `introspection: false`, so the schema is
// read over an authenticated API instead of being served at the public edge:
//
//   schema      GET <extensions edge>/<project>/schema/api   (--deployed), or the
//               core subgraph from /subgraph composed locally with your extension
//   execution   proxied to <graphql edge>/<project>/graphql under a session bearer
//
// AUTH — deliberately ordinary. Operations run as an anonymous shopper, or as a real
// customer who logs in with their own email and password (`--as`). There is no
// impersonation flag and no privileged debug identity: the old console's `x-il-act-as`
// bar ran under the project's service-account credentials, and that is precisely what
// is not reimplemented here. To see what a customer sees, log in as them.
//
// PRESENTMENT — prices are selected from the session's locale/currency/country, which
// the integration layer resolves ONCE at mint (it has no per-request override, by
// design). So `--locale/--currency/--country` are mint-time flags: to explore a
// different market, restart the explorer. Send none and you get the project's
// configured defaults, like a storefront with no locale switcher.

import { access, readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { Flags } from "@oclif/core";
import { IntegrationLayerCommand, graphqlEdgeUrlForRegion, authEdgeUrlForRegion } from "../../lib/base.js";
import { fetchSubgraphSdl, fetchDeployedApiSchemaSdl } from "../../lib/ilClient.js";
import { buildBundle, defaultEntry, defaultOutfile } from "../../lib/tooling/build.js";
import { loadBundleSource } from "../../lib/tooling/loadBundle.js";
import { buildSchema } from "graphql";
import {
  composeLocalExplorerSchema,
  type ExplorerSchema,
} from "../../lib/tooling/exploreSchema.js";
import { mintSession, type SessionGrant } from "../../lib/tooling/session.js";
import { createExplorerServer } from "../../lib/tooling/explorerServer.js";

export default class Explore extends IntegrationLayerCommand {
  static override description =
    "Run a local GraphQL explorer in your browser, against your project's deployed edge";

  static override examples = [
    "<%= config.bin %> integration-layer explore",
    "<%= config.bin %> integration-layer explore --deployed",
    "<%= config.bin %> integration-layer explore --as alice@example.com",
    "<%= config.bin %> integration-layer explore --currency EUR --country DE --locale de-DE",
    "<%= config.bin %> integration-layer explore --deployed --port 5000",
  ];

  static override flags = {
    port: Flags.integer({
      char: "p",
      description: "port to serve the explorer on",
      default: 4000,
    }),
    deployed: Flags.boolean({
      description:
        "render the project's DEPLOYED composed schema (read from Hive) instead of composing the core subgraph with your local extension",
      default: false,
    }),
    as: Flags.string({
      description:
        "run operations as this customer (an ordinary email/password login; prompts for the password unless IL_CUSTOMER_PASSWORD is set). Omit to run anonymously.",
    }),
    // Presentment. Applied at mint, because that is the only place the integration
    // layer lets it be chosen; omitted flags fall back to the project's config.
    locale: Flags.string({
      description: "locale to run operations in, e.g. de-DE (default: the project's)",
      helpGroup: "PRESENTMENT",
    }),
    currency: Flags.string({
      description: "currency prices are shown in, e.g. EUR (default: the project's)",
      helpGroup: "PRESENTMENT",
    }),
    country: Flags.string({
      description: "country prices are selected for, e.g. DE (default: the project's)",
      helpGroup: "PRESENTMENT",
    }),
    "graphql-url": Flags.string({
      description:
        "GraphQL edge base URL — the router (also settable via IL_GRAPHQL_URL); overrides the URL derived from your login region",
      env: "IL_GRAPHQL_URL",
      helpGroup: "INTEGRATION LAYER",
    }),
    "auth-url": Flags.string({
      description:
        "identity edge base URL, where sessions are minted (also settable via IL_AUTH_URL); overrides the URL derived from your login region",
      env: "IL_AUTH_URL",
      helpGroup: "INTEGRATION LAYER",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Explore);
    const { baseUrl, projectKey, token } = await this.resolveIlContext(flags);
    const principal = this.requirePrincipal();

    // The three edges are distinct hosts in the deployed topology (extensions./
    // graphql./auth.), so each is resolved from the login region and independently
    // overridable. Fail loudly rather than guess.
    const graphqlUrl = flags["graphql-url"] ?? graphqlEdgeUrlForRegion(principal.getRegion());
    if (!graphqlUrl) {
      throw new Error(
        "could not resolve the GraphQL edge URL: pass --graphql-url or set IL_GRAPHQL_URL " +
          "(e.g. https://graphql.integration-layer.eu-central-1.aws.commercetools.com)",
      );
    }
    const authUrl = flags["auth-url"] ?? authEdgeUrlForRegion(principal.getRegion());
    if (!authUrl) {
      throw new Error(
        "could not resolve the identity edge URL: pass --auth-url or set IL_AUTH_URL " +
          "(e.g. https://auth.integration-layer.eu-central-1.aws.commercetools.com)",
      );
    }

    const resolved = await this.resolveSchema(flags.deployed, baseUrl, projectKey, token);
    const grant = await this.resolveGrant(flags.as);
    const session = await mintSession(authUrl, projectKey, grant, {
      locale: flags.locale,
      currency: flags.currency,
      country: flags.country,
    });

    const endpoint = `${graphqlUrl.replace(/\/+$/, "")}/${encodeURIComponent(projectKey)}/graphql`;
    const server = createExplorerServer({
      schema: resolved.schema,
      endpoint,
      bearer: session.token,
      clientVersion: this.config.version,
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(flags.port, "127.0.0.1", resolve);
    });

    this.log(
      [
        "",
        `🔎 GraphQL explorer for '${projectKey}'`,
        `   http://localhost:${flags.port}`,
        "",
        `   schema     ${resolved.describe}`,
        `   operations ${endpoint}`,
        `   running as ${session.describe}`,
        `   prices in  ${session.presentment}`,
        "",
        "   Ctrl-C to stop.",
        "",
      ].join("\n"),
    );

    // Serve until interrupted.
    await new Promise<void>((resolve) => {
      const stop = () => {
        server.close(() => {
          resolve();
        });
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  }

  /** The schema GraphiQL renders — deployed composed graph, or a local composition. */
  private async resolveSchema(
    deployed: boolean,
    baseUrl: string,
    projectKey: string,
    token: string,
  ): Promise<ExplorerSchema> {
    if (deployed) {
      this.log(`Fetching the deployed composed schema for '${projectKey}' …`);
      // Already a public API schema — the integration layer reduces it before
      // sending, so there is no supergraph to unpick here. (The LOCAL path below
      // still composes, which is why this command keeps a composition dependency.)
      const apiSdl = await fetchDeployedApiSchemaSdl(baseUrl, projectKey, token);
      return {
        schema: buildSchema(apiSdl),
        sdl: apiSdl,
        describe: "deployed composed graph (from Hive)",
      };
    }

    this.log(`Fetching the core-subgraph SDL for '${projectKey}' …`);
    const coreSdl = await fetchSubgraphSdl(baseUrl, projectKey, token);

    // An extension in the working directory is composed in, so your own fields show
    // up before you have pushed anything. No extension here → core only.
    const entry = defaultEntry();
    if (!(await exists(entry))) return composeLocalExplorerSchema(coreSdl, undefined);

    this.log("Building the extension in this directory …");
    const { outfile } = await buildBundle(entry, defaultOutfile());
    const mod = loadBundleSource(await readFile(outfile, "utf8"));
    const { typeDefs } = mod;
    if (typeof typeDefs !== "string" || typeDefs.trim() === "") {
      // A bundle that exports only API-Extension handlers contributes no subgraph;
      // that is a valid extension, so fall back to core rather than failing.
      this.log("· no GraphQL subgraph in this bundle — showing the core schema only.");
      return composeLocalExplorerSchema(coreSdl, undefined);
    }
    return composeLocalExplorerSchema(coreSdl, typeDefs);
  }

  /** Anonymous, or an ordinary customer login. Never an impersonation. */
  private async resolveGrant(email: string | undefined): Promise<SessionGrant> {
    if (!email) return { kind: "anonymous" };

    const fromEnv = process.env.IL_CUSTOMER_PASSWORD;
    if (fromEnv) return { kind: "password", email, password: fromEnv };

    if (!process.stdin.isTTY) {
      throw new Error(
        `--as ${email} needs that customer's password: set IL_CUSTOMER_PASSWORD ` +
          "(there is no TTY here to prompt on)",
      );
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const password = await rl.question(`Password for ${email}: `);
      if (!password) throw new Error("no password entered");
      return { kind: "password", email, password };
    } finally {
      rl.close();
    }
  }

}

/** Whether a path exists (the local extension entry point). */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
