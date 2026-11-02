// Exercises the `serve --all` / `push --all` building blocks: merging SEVERAL
// extensions into the ONE subgraph a project deploys, and standing up a real Apollo
// federated gateway over a mock Commerce Integration Layer + that single combined subgraph —
// the deployed two-subgraph topology, without needing a `commercetools auth login`.

import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { parse } from "graphql";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { createYoga } from "graphql-yoga";
import { useApolloFederation } from "@envelop/apollo-federation";
import { afterEach, describe, expect, it } from "vitest";
import { composeWithIntegrationLayer } from "../../src/lib/tooling/compose.js";
import { mergeExtensionSubgraph } from "../../src/lib/tooling/extensions.js";
import { makeGateway } from "../../src/lib/tooling/gateway.js";

const FED = `extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")`;
const IL_SDL = `${FED}\n  type Query { coreField: String! }`;
const A_SDL = `${FED}\n  type Query { hello(name: String): String! }`;
const B_SDL = `${FED}\n  type Query { goodbye: String! }`;

const helloResolvers = { Query: { hello: (_p: unknown, { name }: { name?: string }) => `hi ${name ?? "world"}` } };
const goodbyeResolvers = { Query: { goodbye: () => "bye" } };

describe("mergeExtensionSubgraph", () => {
  it("merges several extensions into one subgraph carrying every field", () => {
    const merged = mergeExtensionSubgraph([
      { name: "hello-world", typeDefs: A_SDL, resolvers: helloResolvers },
      { name: "goodbye-world", typeDefs: B_SDL, resolvers: goodbyeResolvers },
    ]);
    // One subgraph SDL with both extensions' root fields on the single `Query`.
    expect(merged.sdl).toContain("hello(");
    expect(merged.sdl).toContain("goodbye");
    const fields = merged.schema.getQueryType()?.getFields() ?? {};
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(["hello", "goodbye"]));
  });

  it("throws (with the field name) when two extensions declare the same field", () => {
    expect(() =>
      mergeExtensionSubgraph([
        { name: "a", typeDefs: A_SDL, resolvers: helloResolvers },
        { name: "b", typeDefs: A_SDL, resolvers: helloResolvers },
      ]),
    ).toThrow(/hello/i);
  });
});

describe("federated gateway over the IL + the combined extensions subgraph", () => {
  const servers: Server[] = [];
  let gateway: Awaited<ReturnType<typeof makeGateway>> | undefined;

  afterEach(async () => {
    if (gateway) await gateway.stop();
    gateway = undefined;
    await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    servers.length = 0;
  });

  const listen = (handler: Parameters<typeof createServer>[1]): Promise<number> => {
    const server = createServer(handler);
    servers.push(server);
    return new Promise((resolve) =>
      server.listen(0, () => resolve((server.address() as AddressInfo).port)),
    );
  };

  it("routes core + both merged extension fields in one query", async () => {
    // The mock Commerce Integration Layer: a real subgraph serving `coreField` at /graphql.
    const ilSchema = buildSubgraphSchema([
      { typeDefs: parse(IL_SDL), resolvers: { Query: { coreField: () => "core" } } },
    ]);
    const ilYoga = createYoga({ schema: ilSchema, graphqlEndpoint: "/graphql", landingPage: false });
    const ilPort = await listen(ilYoga);

    // The TWO extensions merged into ONE subgraph, served at /_extension — the single
    // `extensions` data source the gateway plans over (the deployed bundle's shape).
    const merged = mergeExtensionSubgraph([
      { name: "hello-world", typeDefs: A_SDL, resolvers: helloResolvers },
      { name: "goodbye-world", typeDefs: B_SDL, resolvers: goodbyeResolvers },
    ]);
    const extYoga = createYoga({ schema: merged.schema, graphqlEndpoint: "/_extension", landingPage: false });
    const extPort = await listen((req, res) => {
      const path = (req.url ?? "").split("?")[0];
      if (path.startsWith("/_extension")) return void extYoga(req, res);
      res.statusCode = 404;
      res.end();
    });

    const composed = composeWithIntegrationLayer(IL_SDL, merged.sdl, {
      integrationLayerUrl: `http://localhost:${ilPort}/graphql`,
      extensionUrl: `http://localhost:${extPort}/_extension`,
    });
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;

    gateway = await makeGateway({
      supergraphSdl: composed.supergraphSdl,
      integrationLayerBearer: "dev-session",
    });
    const gatewayYoga = createYoga({
      plugins: [useApolloFederation({ gateway })],
      graphqlEndpoint: "/graphql",
      landingPage: false,
    });

    const res = await gatewayYoga.fetch("http://gateway/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: `{ coreField hello(name: "Rui") goodbye }` }),
    });
    const body = (await res.json()) as { data?: Record<string, string>; errors?: unknown };

    expect(body.errors).toBeUndefined();
    expect(body.data).toEqual({ coreField: "core", hello: "hi Rui", goodbye: "bye" });
  });
});
