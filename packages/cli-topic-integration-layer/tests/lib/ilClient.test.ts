import { describe, expect, it, vi } from "vitest";

import {
  getAllowlist,
  putAllowlist,
  invokeDeployedApiExtension,
  type AuthFetch,
} from "../../src/lib/ilClient.js";

const BASE = "https://extensions.integration-layer.eu-central-1.aws.commercetools.com";
const PROJECT = "my-project";

// The command layer supplies a `CtpAuthFetchFactory` fetch that injects the bearer and
// refreshes/retries it; ilClient never sets an Authorization header itself. So the unit
// here is "does it call the right route with the right method/body", with the auth-fetch
// stubbed — the bearer/refresh behaviour is the auth plugin's own to test.
function stubFetch(response: Response): AuthFetch {
  return vi.fn(async () => response) as unknown as AuthFetch;
}

describe("getAllowlist", () => {
  it("GETs the allowlist route and returns { allow, deny }", async () => {
    const authFetch = stubFetch(
      new Response(JSON.stringify({ allow: ["api.vendor.com"], deny: ["*.internal"] }), {
        status: 200,
      }),
    );

    const result = await getAllowlist(BASE, PROJECT, authFetch);

    expect(result).toEqual({ allow: ["api.vendor.com"], deny: ["*.internal"] });
    const [url, init] = (authFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE}/${PROJECT}/extension/allowlist`);
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("throws with the status + body on a non-2xx response", async () => {
    const authFetch = stubFetch(new Response("project not enrolled", { status: 400 }));
    await expect(getAllowlist(BASE, PROJECT, authFetch)).rejects.toThrow(
      /400.*project not enrolled/,
    );
  });
});

describe("putAllowlist", () => {
  it("PUTs a bare JSON array of patterns and returns { allow, version }", async () => {
    const authFetch = stubFetch(
      new Response(JSON.stringify({ allow: ["api.foo.com", "*.bar.net"], version: 3 }), {
        status: 200,
      }),
    );

    const result = await putAllowlist(BASE, PROJECT, authFetch, ["api.foo.com", "*.bar.net"]);

    expect(result).toEqual({ allow: ["api.foo.com", "*.bar.net"], version: 3 });
    const [url, init] = (authFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE}/${PROJECT}/extension/allowlist`);
    expect(init?.method).toBe("PUT");
    // The route takes a bare array (full replace), NOT an object.
    expect(JSON.parse(String(init?.body))).toEqual(["api.foo.com", "*.bar.net"]);
  });

  it("sends an empty array to clear the allowlist", async () => {
    const authFetch = stubFetch(
      new Response(JSON.stringify({ allow: [], version: 4 }), { status: 200 }),
    );

    await putAllowlist(BASE, PROJECT, authFetch, []);

    const [, init] = (authFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual([]);
  });

  it("throws with the status + body on a validation failure", async () => {
    const authFetch = stubFetch(
      new Response(JSON.stringify({ error: "'*' is too broad" }), { status: 400 }),
    );
    await expect(putAllowlist(BASE, PROJECT, authFetch, ["*"])).rejects.toThrow(/400.*too broad/);
  });
});

describe("invokeDeployedApiExtension", () => {
  const INPUT = { action: "Create", resource: { typeId: "cart", id: "c-1" } };

  it("POSTs the ExtensionInput to the invoke route and returns the { status, result } envelope", async () => {
    const authFetch = stubFetch(
      new Response(JSON.stringify({ status: 200, result: {} }), { status: 200 }),
    );

    const result = await invokeDeployedApiExtension(BASE, PROJECT, authFetch, INPUT);

    expect(result).toEqual({ status: 200, result: {} });
    const [url, init] = (authFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE}/${PROJECT}/extension/api-extensions/invoke`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(INPUT);
  });

  it("passes a connector BLOCK (status 400 in the envelope) through as data, not an error", async () => {
    const authFetch = stubFetch(
      new Response(
        JSON.stringify({ status: 400, result: { errors: [{ code: "X", message: "no" }] } }),
        { status: 200 },
      ),
    );

    const result = await invokeDeployedApiExtension(BASE, PROJECT, authFetch, INPUT);

    // The IL request succeeded (HTTP 200); the connector's 400 is the verdict inside.
    expect(result.status).toBe(400);
    expect(result.result).toEqual({ errors: [{ code: "X", message: "no" }] });
  });

  it("throws with the IL's error message when the deployed extension can't be reached", async () => {
    const authFetch = stubFetch(
      new Response(JSON.stringify({ error: "No extensions-sandbox deployment found" }), {
        status: 404,
      }),
    );
    await expect(invokeDeployedApiExtension(BASE, PROJECT, authFetch, INPUT)).rejects.toThrow(
      /404.*No extensions-sandbox deployment/,
    );
  });
});
