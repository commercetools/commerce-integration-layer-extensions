// The local-dev twin of the connector's `http`/`https` sandbox shim
// (octolog-extensions-sandbox `bundle/sandbox/nodeHttpShim.ts`). `serve` resolves
// `require("http")`/`require("https")` in a bundle to this adapter instead of Node's
// real modules, so an extension author gets the same behaviour locally as in the
// deployed sandbox: `request`/`get` over the allowlist-gated `fetch` (sandboxFetch.ts),
// never a raw socket. It re-implements only the request/response event surface an
// extension realistically touches — `.write`/`.end`, `res.on('data'|'end')`,
// `statusCode`/`headers`/`setEncoding` — not the full Node module.
//
// The `fetch` it routes through is passed in late-bound (`(i, init) => globalThis.fetch(...)`)
// so that, when a resolver runs, it picks up the delegating gated fetch installed by
// `installDelegatingFetch`/`wrapResolverMap` (sandboxFetch.ts) rather than the raw one.
//
// An `Agent` (constructed, or passed as the `agent` request option) is accepted but
// INERT: its settings — keep-alive/pooling, custom CA/mTLS, `rejectUnauthorized`,
// proxy — are silently dropped because every request goes through the gated `fetch`.
// We warn once so a request that depends on such a setting has a breadcrumb.

import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

/** The one mediated network capability the shim routes every request through. */
type FetchImpl = typeof fetch;

/** The `{ http, https }` pair returned to the bundle's `require`. */
export interface NodeHttpShims {
  http: NodeHttpModule;
  https: NodeHttpModule;
}

interface NodeHttpModule {
  request: (...args: unknown[]) => ClientRequestShim;
  get: (...args: unknown[]) => ClientRequestShim;
  /** An inert Agent: `new https.Agent()` works and its methods are no-ops, so SDK
   *  code that constructs one and later calls `.destroy()`/`.getName()` doesn't
   *  throw — but it carries no pooling or TLS config. Constructing one warns once. */
  Agent: new (options?: unknown) => AgentShim;
  globalAgent: AgentShim;
}

interface RequestOptions {
  protocol?: string;
  host?: string;
  hostname?: string;
  port?: number | string;
  path?: string;
  method?: string;
  headers?: Record<string, unknown>;
  agent?: unknown;
}

// One warning per process the first time an (inert) Agent is used.
let agentWarned = false;
function warnAgentIgnored(): void {
  if (agentWarned) return;
  agentWarned = true;
  console.warn(
    "[extension] http/https `Agent` is not supported in the sandbox — its options " +
      "(keep-alive/pooling, custom CA/mTLS, rejectUnauthorized, proxy) are ignored; " +
      "every request goes through the allowlist-gated fetch",
  );
}

/**
 * An inert stand-in for Node's `http.Agent`. Every member is a no-op or empty
 * default so SDK code that pokes at an agent runs without throwing — there is no
 * real connection pool behind it (each request is an independent gated fetch).
 * Constructing one via the public `Agent` warns; `globalAgent` is built directly.
 */
class AgentShim {
  maxSockets = Infinity;
  maxFreeSockets = 256;
  sockets: Record<string, unknown> = {};
  freeSockets: Record<string, unknown> = {};
  requests: Record<string, unknown> = {};
  options: Record<string, unknown> = {};

  destroy(): void {}
  getName(): string {
    return "gated-fetch";
  }
  addRequest(): void {}
  createConnection(): void {}
  createSocket(): void {}
  keepSocketAlive(): boolean {
    return false;
  }
  reuseSocket(): void {}
}

interface NormalizedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  callback?: (res: Readable) => void;
}

/** Coerce a Node header bag (values may be arrays) to fetch's string-valued form. */
function toStringHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    out[key] = Array.isArray(value) ? value.map(String).join(", ") : String(value);
  }
  return out;
}

/** Resolve Node's overloaded `(url | options)[, options][, callback]` forms. */
function normalizeArgs(defaultProtocol: string, args: unknown[]): NormalizedRequest {
  let index = 0;
  let url: string | undefined;
  let options: RequestOptions = {};

  const first = args[0];
  if (typeof first === "string" || first instanceof URL) {
    url = String(first);
    index = 1;
    if (typeof args[index] === "object" && args[index] !== null) {
      options = args[index] as RequestOptions;
      index += 1;
    }
  } else if (typeof first === "object" && first !== null) {
    options = first as RequestOptions;
    index = 1;
  }

  const callback = typeof args[index] === "function" ? (args[index] as NormalizedRequest["callback"]) : undefined;

  if (options.agent != null) warnAgentIgnored();

  let target: string;
  if (url !== undefined) {
    target = url;
  } else {
    const protocol = options.protocol ?? defaultProtocol;
    const host = options.hostname ?? options.host ?? "localhost";
    const port = options.port != null ? `:${options.port}` : "";
    const path = options.path ?? "/";
    target = `${protocol}//${host}${port}${path}`;
  }

  return {
    url: target,
    method: (options.method ?? "GET").toUpperCase(),
    headers: toStringHeaders(options.headers),
    callback,
  };
}

/** Concatenate the written request-body chunks into a single fetch body. */
function buildBody(chunks: (string | Uint8Array)[]): string | Uint8Array | undefined {
  if (chunks.length === 0) return undefined;
  if (chunks.every((chunk) => typeof chunk === "string")) return chunks.join("");
  const encoder = new TextEncoder();
  const parts = chunks.map((chunk) => (typeof chunk === "string" ? encoder.encode(chunk) : chunk));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

/** Adapt a fetch `Response` into a Node `IncomingMessage`-like readable stream. */
function toIncomingMessage(response: Response): Readable {
  // The DOM `ReadableStream` (fetch's `body`) and the `node:stream/web` one that
  // `Readable.fromWeb` is typed against are structurally the same at runtime; cast
  // across the two lib definitions.
  const webStream = response.body as unknown as Parameters<typeof Readable.fromWeb>[0];
  const body = response.body ? Readable.fromWeb(webStream) : Readable.from([]);
  const incoming = body as Readable & {
    statusCode?: number;
    statusMessage?: string;
    headers?: Record<string, string>;
  };
  incoming.statusCode = response.status;
  incoming.statusMessage = response.statusText;
  incoming.headers = Object.fromEntries(response.headers);
  return incoming;
}

/**
 * A `ClientRequest`-like writable. Body chunks are buffered by `write`; `end`
 * dispatches ONE gated `fetch` and, once it resolves, emits `'response'` with the
 * adapted readable (and invokes the request callback). A gate refusal or transport
 * failure surfaces as an `'error'` event.
 */
class ClientRequestShim extends EventEmitter {
  private readonly chunks: (string | Uint8Array)[] = [];
  private readonly controller = new AbortController();
  private headers: Record<string, string>;
  private sent = false;
  private destroyed = false;
  private timeoutMs?: number;

  constructor(
    private readonly target: string,
    private readonly method: string,
    headers: Record<string, string>,
    private readonly fetchImpl: FetchImpl,
    callback?: (res: Readable) => void,
  ) {
    super();
    this.headers = { ...headers };
    if (callback) this.once("response", callback);
  }

  setHeader(name: string, value: unknown): this {
    this.headers[name] = Array.isArray(value) ? value.map(String).join(", ") : String(value);
    return this;
  }

  getHeader(name: string): string | undefined {
    return this.headers[name];
  }

  removeHeader(name: string): void {
    delete this.headers[name];
  }

  setTimeout(ms: number, callback?: () => void): this {
    this.timeoutMs = ms;
    if (callback) this.once("timeout", callback);
    return this;
  }

  write(chunk: string | Uint8Array, encoding?: unknown, callback?: () => void): boolean {
    if (chunk != null) this.chunks.push(chunk);
    const done = typeof encoding === "function" ? (encoding as () => void) : callback;
    done?.();
    return true;
  }

  end(chunk?: string | Uint8Array | (() => void), encoding?: unknown, callback?: () => void): this {
    let done = callback;
    if (typeof chunk === "function") {
      done = chunk;
      chunk = undefined;
    } else if (typeof encoding === "function") {
      done = encoding as () => void;
    }
    if (chunk != null) this.chunks.push(chunk as string | Uint8Array);
    this.send();
    done?.();
    return this;
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.controller.abort();
    if (error) this.emit("error", error);
    return this;
  }

  abort(): void {
    this.destroy();
  }

  private send(): void {
    if (this.sent) return;
    this.sent = true;

    const body = buildBody(this.chunks);
    const init: RequestInit = { method: this.method, headers: this.headers, signal: this.controller.signal };
    // A Uint8Array is a valid runtime `BodyInit`; cast past the narrower DOM type.
    if (body != null && this.method !== "GET" && this.method !== "HEAD") init.body = body as BodyInit;

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (this.timeoutMs != null) {
      timer = setTimeout(() => this.emit("timeout"), this.timeoutMs);
      (timer as { unref?: () => void }).unref?.();
    }

    Promise.resolve()
      .then(() => this.fetchImpl(this.target, init))
      .then((response) => {
        if (timer) clearTimeout(timer);
        this.emit("response", toIncomingMessage(response));
      })
      .catch((error: unknown) => {
        if (timer) clearTimeout(timer);
        if (!this.destroyed) this.emit("error", error);
      });
  }
}

/**
 * Build the `{ http, https }` module pair, each backed by the given gated `fetch`.
 * `http` and `https` differ only in the default protocol applied when a request is
 * described by an options object rather than a full URL.
 */
export function createNodeHttpShims(fetchImpl: FetchImpl): NodeHttpShims {
  const makeModule = (defaultProtocol: string): NodeHttpModule => {
    const request = (...args: unknown[]): ClientRequestShim => {
      const { url, method, headers, callback } = normalizeArgs(defaultProtocol, args);
      return new ClientRequestShim(url, method, headers, fetchImpl, callback);
    };
    const get = (...args: unknown[]): ClientRequestShim => {
      const req = request(...args);
      req.end();
      return req;
    };
    const Agent = class extends AgentShim {
      constructor(_options?: unknown) {
        super();
        warnAgentIgnored();
      }
    };
    return { request, get, Agent, globalAgent: new AgentShim() };
  };

  return { http: makeModule("http:"), https: makeModule("https:") };
}
