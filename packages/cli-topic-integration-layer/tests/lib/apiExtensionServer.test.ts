// Boots the real callback server on a real port and drives it over real HTTP. Body
// validation and the commercetools response mapping are under test; only the handlers
// are a stub.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiExtensionHandler } from "../../src/lib/apiExtensionServer.js";
import type { ApiExtensionDefinition } from "../../src/lib/tooling/apiExtension.js";

const capHandler: ApiExtensionDefinition = {
  key: "quantity-cap",
  resourceTypeId: "cart",
  actions: ["Create", "Update"],
  handler: (input, ctx) => {
    const cap = Number(ctx.config.MAX ?? "10");
    const li = (input.resource as { obj: { lineItems: { id: string; quantity: number }[] } }).obj
      .lineItems[0]!;
    return li.quantity > cap
      ? { actions: [{ action: "changeLineItemQuantity", lineItemId: li.id, quantity: cap }] }
      : {};
  },
};

let server: Server;
let url: string;
let handlers: ApiExtensionDefinition[] = [capHandler];
let config: Record<string, string> = {};

beforeEach(async () => {
  handlers = [capHandler];
  config = {};
  server = createServer(
    createApiExtensionHandler({
      makeCtx: () => ({ now: () => 0, config }),
      handlers: () => handlers,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  url = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(body: unknown): Promise<Response> {
  return fetch(`${url}/api-extensions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const cart = (action: string, quantity: number) => ({
  action,
  resource: { typeId: "cart", id: "c1", obj: { id: "c1", lineItems: [{ id: "li1", quantity }] } },
});

describe("createApiExtensionHandler", () => {
  it("answers GET /health", async () => {
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("approves with an empty 200 when nothing matches / nothing to change", async () => {
    const res = await post(cart("Update", 2));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("returns 200 with actions to MODIFY", async () => {
    const res = await post(cart("Update", 25));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      actions: [{ action: "changeLineItemQuantity", lineItemId: "li1", quantity: 10 }],
    });
  });

  it("honours ctx.config read fresh per request (hot-reloadable)", async () => {
    config = { MAX: "100" }; // now 25 is under the cap → approve
    const res = await post(cart("Update", 25));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("returns 400 with errors to BLOCK", async () => {
    handlers = [
      {
        key: "block",
        resourceTypeId: "cart",
        actions: ["Create"],
        handler: () => ({ errors: [{ code: "Nope", message: "blocked" }] }),
      },
    ];
    const res = await post(cart("Create", 1));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ errors: [{ code: "Nope", message: "blocked" }] });
  });

  it("400s a body that is not an ExtensionInput", async () => {
    expect((await post({ nonsense: true })).status).toBe(400);
  });

  it("500s when a handler throws", async () => {
    handlers = [
      {
        key: "boom",
        resourceTypeId: "cart",
        actions: ["Create"],
        handler: () => {
          throw new Error("kaboom");
        },
      },
    ];
    const res = await post(cart("Create", 1));
    expect(res.status).toBe(500);
    expect((await res.json()).errors[0].message).toBe("kaboom");
  });

  it("404s an unknown route", async () => {
    expect((await fetch(`${url}/nope`, { method: "POST" })).status).toBe(404);
  });
});
