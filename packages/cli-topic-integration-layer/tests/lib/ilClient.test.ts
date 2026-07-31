import { afterEach, describe, expect, it, vi } from "vitest";

import { getAllowlist, putAllowlist } from "../../src/lib/ilClient.js";

const BASE = "https://extensions.integration-layer.eu-central-1.aws.commercetools.com";
const PROJECT = "my-project";
const TOKEN = "the-access-token";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAllowlist", () => {
  it("GETs the allowlist route with the bearer and returns { allow, deny }", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ allow: ["api.vendor.com"], deny: ["*.internal"] }), {
          status: 200,
        }),
      );

    const result = await getAllowlist(BASE, PROJECT, TOKEN);

    expect(result).toEqual({ allow: ["api.vendor.com"], deny: ["*.internal"] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/${PROJECT}/extension/allowlist`);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("throws with the status + body on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("project not enrolled", { status: 400 }),
    );
    await expect(getAllowlist(BASE, PROJECT, TOKEN)).rejects.toThrow(/400.*project not enrolled/);
  });
});

describe("putAllowlist", () => {
  it("PUTs a bare JSON array of patterns and returns { allow, version }", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ allow: ["api.foo.com", "*.bar.net"], version: 3 }), {
          status: 200,
        }),
      );

    const result = await putAllowlist(BASE, PROJECT, TOKEN, ["api.foo.com", "*.bar.net"]);

    expect(result).toEqual({ allow: ["api.foo.com", "*.bar.net"], version: 3 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/${PROJECT}/extension/allowlist`);
    expect(init?.method).toBe("PUT");
    // The route takes a bare array (full replace), NOT an object.
    expect(JSON.parse(String(init?.body))).toEqual(["api.foo.com", "*.bar.net"]);
  });

  it("sends an empty array to clear the allowlist", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ allow: [], version: 4 }), { status: 200 }));

    await putAllowlist(BASE, PROJECT, TOKEN, []);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual([]);
  });

  it("throws with the status + body on a validation failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "'*' is too broad" }), { status: 400 }),
    );
    await expect(putAllowlist(BASE, PROJECT, TOKEN, ["*"])).rejects.toThrow(/400.*too broad/);
  });
});
