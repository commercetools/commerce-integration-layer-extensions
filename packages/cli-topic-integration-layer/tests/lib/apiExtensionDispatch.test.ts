import { describe, expect, it } from "vitest";

import {
  describeResult,
  dispatchApiExtension,
  extractApiExtensions,
  handlerMatches,
} from "../../src/lib/tooling/apiExtensionDispatch.js";
import type {
  ApiExtensionDefinition,
  ApiExtensionInput,
  ExtensionContext,
} from "../../src/lib/tooling/apiExtension.js";

const ctx: ExtensionContext = { now: () => 0, config: {} };

/** A minimal cart callback in the SDK's ExtensionInput shape. */
function cartInput(action: "Create" | "Update", quantity = 1): ApiExtensionInput {
  return {
    action,
    resource: { typeId: "cart", id: "c1", obj: { id: "c1", lineItems: [{ id: "li1", quantity }] } },
  } as unknown as ApiExtensionInput;
}

const capHandler: ApiExtensionDefinition = {
  key: "quantity-cap",
  resourceTypeId: "cart",
  actions: ["Create", "Update"],
  handler: (input) => {
    const li = (input.resource as { obj: { lineItems: { id: string; quantity: number }[] } }).obj
      .lineItems[0]!;
    return li.quantity > 10
      ? { actions: [{ action: "changeLineItemQuantity", lineItemId: li.id, quantity: 10 }] }
      : {};
  },
};

const blockHandler: ApiExtensionDefinition = {
  key: "block-it",
  resourceTypeId: "cart",
  actions: ["Create"],
  handler: () => ({ errors: [{ code: "Blocked", message: "no" }] }),
};

describe("extractApiExtensions", () => {
  it("returns the array when present and [] otherwise", () => {
    expect(extractApiExtensions({ apiExtensions: [capHandler] })).toEqual([capHandler]);
    expect(extractApiExtensions({})).toEqual([]);
    expect(extractApiExtensions({ apiExtensions: "nope" })).toEqual([]);
  });
});

describe("handlerMatches", () => {
  it("matches on resource + action, not otherwise", () => {
    expect(handlerMatches(capHandler, "cart", "Update")).toBe(true);
    expect(handlerMatches(blockHandler, "cart", "Update")).toBe(false); // Create only
    expect(handlerMatches(capHandler, "order", "Create")).toBe(false);
  });
});

describe("dispatchApiExtension", () => {
  it("approves (200, no body) when no handler matches", async () => {
    const r = await dispatchApiExtension([blockHandler], ctx, cartInput("Update"));
    expect(r).toEqual({ status: 200 });
  });

  it("approves (200, no body) when a matching handler returns {}", async () => {
    const r = await dispatchApiExtension([capHandler], ctx, cartInput("Update", 2));
    expect(r).toEqual({ status: 200 });
  });

  it("returns 200 with merged actions to MODIFY", async () => {
    const r = await dispatchApiExtension([capHandler], ctx, cartInput("Update", 25));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      actions: [{ action: "changeLineItemQuantity", lineItemId: "li1", quantity: 10 }],
    });
  });

  it("returns 400 with errors to BLOCK, even alongside actions", async () => {
    const r = await dispatchApiExtension([capHandler, blockHandler], ctx, cartInput("Create", 25));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ errors: [{ code: "Blocked", message: "no" }] });
  });

  it("propagates a thrown handler (does not swallow into approve)", async () => {
    const thrower: ApiExtensionDefinition = {
      key: "boom",
      resourceTypeId: "cart",
      actions: ["Create"],
      handler: () => {
        throw new Error("kaboom");
      },
    };
    await expect(dispatchApiExtension([thrower], ctx, cartInput("Create"))).rejects.toThrow(
      "kaboom",
    );
  });
});

describe("describeResult", () => {
  it("summarises approve / modify / block", () => {
    expect(describeResult({})).toBe("APPROVE");
    expect(describeResult(undefined)).toBe("APPROVE");
    expect(describeResult({ actions: [{ action: "x" }] })).toContain("MODIFY");
    expect(describeResult({ errors: [{ code: "C", message: "m" }] })).toBe("BLOCK — C: m");
  });
});
