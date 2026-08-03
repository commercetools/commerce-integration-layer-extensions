import { describe, expect, it, vi } from "vitest";

import {
  createExtension,
  ctApiBaseUrl,
  deleteExtension,
  draftFor,
  isManagedKey,
  listExtensions,
  managedKey,
  planReconcile,
  triggerSignature,
  type AuthFetch,
  type RegisteredExtension,
} from "../../src/lib/ctExtensions.js";
import type { ApiExtensionDefinition } from "../../src/lib/tooling/apiExtension.js";

const PROJECT = "my-project";
const API = "https://api.eu-central-1.aws.commercetools.com";

function stubFetch(response: Response): AuthFetch {
  return vi.fn(async () => response) as unknown as AuthFetch;
}

/** A declaration; the handler is irrelevant to the CT-registration surface. */
function decl(
  key: string,
  overrides: Partial<ApiExtensionDefinition> = {},
): ApiExtensionDefinition {
  return {
    key,
    resourceTypeId: "cart",
    actions: ["Create", "Update"],
    handler: () => ({}),
    ...overrides,
  };
}

describe("ctApiBaseUrl", () => {
  it("builds the region-specific commercetools API host", () => {
    expect(ctApiBaseUrl("eu-central-1.aws")).toBe(API);
    expect(ctApiBaseUrl("europe-west1.gcp")).toBe(
      "https://api.europe-west1.gcp.commercetools.com",
    );
  });

  it("throws loudly when the region is empty", () => {
    expect(() => ctApiBaseUrl("  ")).toThrow(/region/);
  });
});

describe("managed keys", () => {
  it("prefixes and recognises its own keys", () => {
    expect(managedKey("quantity-cap")).toBe("il-localdev-quantity-cap");
    expect(isManagedKey("il-localdev-quantity-cap")).toBe(true);
    expect(isManagedKey("some-real-extension")).toBe(false);
    expect(isManagedKey(undefined)).toBe(false);
  });
});

describe("draftFor", () => {
  it("maps a declaration to an HTTP destination with the shared-secret header", () => {
    const draft = draftFor(decl("quantity-cap", { condition: "true" }), `${API}/x/api-extensions`, "Bearer s3cret");
    expect(draft).toEqual({
      key: "il-localdev-quantity-cap",
      destination: {
        type: "HTTP",
        url: `${API}/x/api-extensions`,
        authentication: { type: "AuthorizationHeader", headerValue: "Bearer s3cret" },
      },
      triggers: [{ resourceTypeId: "cart", actions: ["Create", "Update"], condition: "true" }],
    });
  });

  it("omits condition when the declaration has none", () => {
    const draft = draftFor(decl("k"), "https://u/api-extensions", "Bearer s");
    expect(draft.triggers[0]).not.toHaveProperty("condition");
  });
});

describe("planReconcile", () => {
  const sigOf = (d: ApiExtensionDefinition): string => triggerSignature(d);
  const reg = (d: ApiExtensionDefinition): RegisteredExtension => ({
    authorKey: d.key,
    id: `id-${d.key}`,
    version: 1,
    signature: sigOf(d),
  });

  it("creates all when nothing is registered", () => {
    const desired = [decl("a"), decl("b")];
    const plan = planReconcile([], desired);
    expect(plan.toCreate).toEqual(desired);
    expect(plan.toDelete).toEqual([]);
  });

  it("is a no-op when registered matches desired (a handler-only edit)", () => {
    const a = decl("a");
    const plan = planReconcile([reg(a)], [decl("a")]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });

  it("deletes a removed declaration", () => {
    const a = decl("a");
    const plan = planReconcile([reg(a)], []);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toDelete).toEqual([reg(a)]);
  });

  it("recreates a declaration whose trigger shape changed (in both lists)", () => {
    const before = decl("a", { condition: "old" });
    const after = decl("a", { condition: "new" });
    const plan = planReconcile([reg(before)], [after]);
    expect(plan.toCreate).toEqual([after]);
    expect(plan.toDelete).toEqual([reg(before)]);
  });
});

describe("listExtensions / createExtension / deleteExtension", () => {
  it("GETs the extensions route and returns results", async () => {
    const authFetch = stubFetch(
      new Response(JSON.stringify({ results: [{ id: "1", key: "k", version: 2 }] }), { status: 200 }),
    );
    const result = await listExtensions(API, PROJECT, authFetch);
    expect(result).toEqual([{ id: "1", key: "k", version: 2 }]);
    const [url] = (authFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${API}/${PROJECT}/extensions?limit=100`);
  });

  it("POSTs a draft and returns the created id + version", async () => {
    const authFetch = stubFetch(
      new Response(JSON.stringify({ id: "new-id", key: "il-localdev-a", version: 1 }), { status: 201 }),
    );
    const draft = draftFor(decl("a"), "https://u/api-extensions", "Bearer s");
    const created = await createExtension(API, PROJECT, authFetch, draft);
    expect(created).toEqual({ id: "new-id", key: "il-localdev-a", version: 1 });
    const [url, init] = (authFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${API}/${PROJECT}/extensions`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(draft);
  });

  it("DELETEs by id + version and treats 404 as done", async () => {
    const ok = stubFetch(new Response(null, { status: 200 }));
    await expect(deleteExtension(API, PROJECT, ok, "the-id", 3)).resolves.toBeUndefined();
    const [url, init] = (ok as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${API}/${PROJECT}/extensions/the-id?version=3`);
    expect(init?.method).toBe("DELETE");

    const gone = stubFetch(new Response("not found", { status: 404 }));
    await expect(deleteExtension(API, PROJECT, gone, "the-id", 3)).resolves.toBeUndefined();
  });

  it("throws with status + body on a non-2xx create", async () => {
    const authFetch = stubFetch(new Response("duplicate key", { status: 409 }));
    await expect(
      createExtension(API, PROJECT, authFetch, draftFor(decl("a"), "https://u/api-extensions", "Bearer s")),
    ).rejects.toThrow(/409.*duplicate key/);
  });
});
