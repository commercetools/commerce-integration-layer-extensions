// The HTTP surface `serve-api-extension` exposes to commercetools: a single
// `POST /api-extensions` callback (plus a `GET /health` for tunnel checks). Kept
// separate from the oclif command so it can be unit-tested by driving a real server
// with a stub set of handlers — no login, no tunnel, no commercetools.
//
// The request is authenticated by a shared-secret bearer (the same value registered
// as the Extension's Authorization header), then handed to the shared dispatcher,
// whose result is written back in the commercetools response contract (empty 200
// approve / 200 `{ actions }` / 400 `{ errors }`, or 500 when a handler throws).

import type { IncomingMessage, ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { dispatchApiExtension } from "./tooling/apiExtensionDispatch.js";
import type { ApiExtensionDefinition, ExtensionContext } from "./tooling/apiExtension.js";

/** Cap the callback body so a malformed/oversized POST can't exhaust memory. */
export const MAX_BODY_BYTES = 1_048_576; // 1 MiB — well above any real ExtensionInput.

/** Constant-time check that the callback carried the shared secret we registered. */
export function verifyBearer(header: string | undefined, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  if (typeof header !== "string" || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/** Read a request body as a string, rejecting once it exceeds `maxBytes`. */
export function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export interface ApiExtensionHandlerOptions {
  /** The shared secret commercetools must present (verified against `Bearer <secret>`). */
  secret: string;
  /** The per-call capability context (fresh per request, so config edits are picked up). */
  makeCtx: () => ExtensionContext;
  /** The current handlers (a getter, so a hot-reload swap is seen without rewiring). */
  handlers: () => ApiExtensionDefinition[];
  /** Optional: called with a one-line summary of each dispatched callback (for logging). */
  onDispatch?: (summary: string) => void;
  /** Optional: called when a handler throws (the request still 500s). */
  onError?: (err: Error) => void;
}

/**
 * Build the `(req, res)` listener for the local callback server. Exported (rather than
 * inlined in the command) so tests can exercise the auth gate + response mapping
 * against a real HTTP server.
 */
export function createApiExtensionHandler(
  options: ApiExtensionHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const { secret, makeCtx, handlers, onDispatch, onError } = options;

  return (req, res) => {
    void handle(req, res);
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/health") {
      res.statusCode = 200;
      res.end("ok");
      return;
    }
    if (req.method !== "POST" || path !== "/api-extensions") {
      sendJson(res, 404, { errors: [{ code: "General", message: "not found" }] });
      return;
    }
    if (!verifyBearer(req.headers.authorization, secret)) {
      sendJson(res, 401, {
        errors: [{ code: "Unauthorized", message: "Invalid extension credentials" }],
      });
      return;
    }

    let input: { action?: unknown; resource?: { typeId?: unknown } };
    try {
      input = JSON.parse(await readBody(req));
    } catch (err) {
      sendJson(res, 400, {
        errors: [{ code: "InvalidInput", message: `invalid callback body: ${(err as Error).message}` }],
      });
      return;
    }
    if (!input || typeof input.action !== "string" || typeof input.resource?.typeId !== "string") {
      sendJson(res, 400, {
        errors: [{ code: "InvalidInput", message: "body is not a commercetools ExtensionInput" }],
      });
      return;
    }

    try {
      const result = await dispatchApiExtension(
        handlers(),
        makeCtx(),
        // Validated above; hand to the shared dispatcher as the SDK input.
        input as unknown as Parameters<typeof dispatchApiExtension>[2],
      );
      const summary =
        result.status === 400
          ? "BLOCK"
          : result.body && "actions" in result.body
            ? `MODIFY (${result.body.actions.length})`
            : "APPROVE";
      onDispatch?.(`${String(input.action)} ${String(input.resource.typeId)}: ${summary}`);
      if (result.body) sendJson(res, result.status, result.body);
      else {
        res.statusCode = result.status;
        res.end();
      }
    } catch (err) {
      // A handler threw — fail the write loudly (500), mirroring the deployed sandbox.
      onError?.(err as Error);
      sendJson(res, 500, { errors: [{ code: "General", message: (err as Error).message }] });
    }
  }
}
