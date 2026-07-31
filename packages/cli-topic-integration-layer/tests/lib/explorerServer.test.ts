// Boots the real explorer server on a real port and drives it over real HTTP,
// against a stub "edge". Nothing is mocked out of the path under test: if the
// routing, the local-introspection answer, or the bearer attachment breaks, these
// fail.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildSchema } from "graphql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createExplorerServer } from "../../src/lib/tooling/explorerServer.js";

const SCHEMA = buildSchema(`
  type Category { name: String! }
  type CategoryResult { items: [Category!]! total: Int! }
  type Query { categories: CategoryResult! }
`);

const BEARER = "session-token-abc";

/** A request the stub edge recorded. */
interface Recorded {
  authorization?: string;
  clientName?: string;
  clientVersion?: string;
  body: unknown;
}

let edge: Server;
let explorer: Server;
let edgeUrl: string;
let explorerUrl: string;
let recorded: Recorded[];
/** What the stub edge replies with (status + body), settable per test. */
let edgeReply: { status: number; body: unknown };

const singleHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });

beforeEach(async () => {
  recorded = [];
  edgeReply = { status: 200, body: { data: { categories: { total: 7 } } } };

  edge = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      recorded.push({
        authorization: singleHeader(req.headers.authorization),
        clientName: singleHeader(req.headers["graphql-client-name"]),
        clientVersion: singleHeader(req.headers["graphql-client-version"]),
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      res.writeHead(edgeReply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(edgeReply.body));
    });
  });
  edgeUrl = `${await listen(edge)}/graphql`;

  explorer = createExplorerServer({
    schema: SCHEMA,
    endpoint: edgeUrl,
    bearer: BEARER,
    clientVersion: "1.2.3",
  });
  explorerUrl = await listen(explorer);
});

afterEach(async () => {
  await close(explorer);
  await close(edge);
});

const post = (body: unknown) =>
  fetch(`${explorerUrl}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("the explorer server", () => {
  it("serves the GraphiQL page at /", async () => {
    const res = await fetch(explorerUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("GraphQL Explorer");
    // The page is same-origin and credential-free — the bearer stays server-side.
    expect(html).not.toContain(BEARER);
  });

  it("answers introspection LOCALLY, without touching the edge", async () => {
    const res = await post({ query: "{ __schema { queryType { name } } }" });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: { __schema?: { queryType?: { name?: string } } } };
    expect(json.data?.__schema?.queryType?.name).toBe("Query");
    // The whole point: the edge has introspection disabled, so it must not be asked.
    expect(recorded).toHaveLength(0);
  });

  it("proxies a real operation to the edge WITH the session bearer", async () => {
    const res = await post({ query: "{ categories { total } }" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { categories: { total: 7 } } });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].authorization).toBe(`Bearer ${BEARER}`);
    expect(recorded[0].clientName).toBe("commercetools-integration-layer-cli");
    expect(recorded[0].clientVersion).toBe("1.2.3");
    expect(recorded[0].body).toEqual({ query: "{ categories { total } }" });
  });

  it("forwards variables and operationName untouched", async () => {
    await post({
      query: "query A($x: Int) { categories { total } }",
      variables: { x: 1 },
      operationName: "A",
    });
    expect(recorded[0].body).toEqual({
      query: "query A($x: Int) { categories { total } }",
      variables: { x: 1 },
      operationName: "A",
    });
  });

  it("passes an edge error through with its status, rather than masking it", async () => {
    edgeReply = { status: 401, body: { errors: [{ message: "session expired" }] } };

    const res = await post({ query: "{ categories { total } }" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ errors: [{ message: "session expired" }] });
  });

  it("does not answer a query that merely mentions __schema locally", async () => {
    await post({ query: '{ categories { total } __typenameNot: categories { total } }' });
    expect(recorded).toHaveLength(1);
  });

  it("rejects a body with no query", async () => {
    const res = await post({ variables: {} });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/must include a 'query'/);
    expect(recorded).toHaveLength(0);
  });

  it("rejects invalid JSON", async () => {
    const res = await fetch(`${explorerUrl}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(recorded).toHaveLength(0);
  });

  it("405s a GET on the GraphQL endpoint and 404s anything else", async () => {
    expect((await fetch(`${explorerUrl}/graphql`)).status).toBe(405);
    expect((await fetch(`${explorerUrl}/nope`)).status).toBe(404);
  });

  it("502s with the endpoint named when the edge is unreachable", async () => {
    await close(edge);
    const res = await post({ query: "{ categories { total } }" });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).toContain(edgeUrl);
  });
});

describe("endpoint validation", () => {
  it("rejects a non-http(s) endpoint at construction, not at the first query", () => {
    expect(() =>
      createExplorerServer({ schema: SCHEMA, endpoint: "file:///etc/passwd", bearer: BEARER }),
    ).toThrow(/must be http\(s\)/);
  });

  it("rejects a malformed endpoint with a clear message", () => {
    expect(() =>
      createExplorerServer({ schema: SCHEMA, endpoint: "not a url", bearer: BEARER }),
    ).toThrow(/not a valid URL/);
  });
});
