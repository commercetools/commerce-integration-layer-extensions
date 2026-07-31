// The explorer's local HTTP server.
//
// Three responsibilities, and the split between the last two is the whole design:
//
//   GET  /          the GraphiQL page
//   POST /graphql   introspection → answered HERE from the resolved schema, because
//                   the deployed edge runs `introspection: false`
//                   everything else → proxied to the edge under a session bearer
//
// The bearer never reaches the browser: the page is same-origin and this process
// attaches the credential on the way out.
//
// Kept out of the command so it can be started and driven in tests against a stub
// edge, rather than only exercised by hand.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { execute, parse, validate, type GraphQLSchema } from "graphql";
import { EXPLORER_HTML } from "./explorerPage.js";
import { isIntrospectionRequest } from "./introspectionRequest.js";

/** The GraphQL-over-HTTP request body GraphiQL sends. */
export interface GraphQLBody {
  query?: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

/** Default Hive usage identity when the caller does not override it. */
export const DEFAULT_GRAPHQL_CLIENT_NAME = "commercetools-integration-layer-cli";

export interface ExplorerServerOptions {
  /** The schema introspection is answered from (docs, autocomplete, validation). */
  schema: GraphQLSchema;
  /** Absolute URL of the deployed edge's per-project GraphQL endpoint. */
  endpoint: string;
  /** Session bearer attached to every proxied operation. Never sent to the browser. */
  bearer: string;
  /** Hive `graphql-client-name` on proxied operations (introspection stays local). */
  clientName?: string;
  /** Hive `graphql-client-version` on proxied operations. */
  clientVersion?: string;
}

/**
 * Build (but do not listen on) the explorer's server.
 *
 * The edge endpoint is validated ONCE here, not per request: it must be an
 * absolute `http:`/`https:` URL. It comes from the operator's own login region or
 * their explicit `--graphql-url` / `IL_GRAPHQL_URL`, so this is not a trust
 * boundary — but pinning the scheme up front means a typo or a stray `file://`
 * fails at startup with a clear message rather than at the first query, and the
 * value the proxy uses can never be anything else.
 */
export function createExplorerServer(opts: ExplorerServerOptions): Server {
  let parsed: URL;
  try {
    parsed = new URL(opts.endpoint);
  } catch {
    throw new Error(`the GraphQL edge endpoint is not a valid URL: ${opts.endpoint}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `the GraphQL edge endpoint must be http(s), got '${parsed.protocol}': ${opts.endpoint}`,
    );
  }
  const endpoint = parsed.toString();

  return createServer((req, res) => {
    void handle(req, res, { ...opts, endpoint });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ExplorerServerOptions,
): Promise<void> {
  const path = (req.url ?? "/").split("?")[0];
  const json = (status: number, payload: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(EXPLORER_HTML);
    return;
  }
  if (path !== "/graphql") {
    json(404, { errors: [{ message: `no route ${path}` }] });
    return;
  }
  if (req.method !== "POST") {
    json(405, { errors: [{ message: "the GraphQL endpoint accepts POST" }] });
    return;
  }

  let body: GraphQLBody;
  try {
    body = JSON.parse(await readBody(req)) as GraphQLBody;
  } catch (err) {
    json(400, { errors: [{ message: `invalid JSON body: ${(err as Error).message}` }] });
    return;
  }

  const query = body.query ?? "";
  if (!query.trim()) {
    json(400, { errors: [{ message: "request body must include a 'query'" }] });
    return;
  }

  if (isIntrospectionRequest(query, body.operationName)) {
    let document;
    try {
      document = parse(query);
    } catch (err) {
      json(400, { errors: [{ message: (err as Error).message }] });
      return;
    }
    const errors = validate(opts.schema, document);
    if (errors.length) {
      json(400, { errors: errors.map((e) => ({ message: e.message })) });
      return;
    }
    json(
      200,
      await execute({
        schema: opts.schema,
        document,
        variableValues: body.variables,
        operationName: body.operationName,
      }),
    );
    return;
  }

  try {
    // Not SSRF: `opts.endpoint` is fixed when the server is constructed, from the
    // operator's OWN login region or their explicit --graphql-url/IL_GRAPHQL_URL,
    // and validated to be an absolute http(s) URL there. Nothing in the request
    // influences it — the body is forwarded, the destination is not. The server
    // also binds 127.0.0.1, so the only caller is the developer who chose the URL;
    // there is no privilege boundary for a forged request to cross.
    // nosemgrep
    const upstream = await fetch(opts.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${opts.bearer}`,
        "graphql-client-name": opts.clientName ?? DEFAULT_GRAPHQL_CLIENT_NAME,
        "graphql-client-version": opts.clientVersion ?? "dev",
      },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    });
    res.end(text);
  } catch (err) {
    json(502, {
      errors: [{ message: `could not reach ${opts.endpoint}: ${(err as Error).message}` }],
    });
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
