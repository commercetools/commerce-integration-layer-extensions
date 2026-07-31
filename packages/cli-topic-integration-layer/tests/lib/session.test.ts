import { afterEach, describe, expect, it, vi } from "vitest";

import { mintSession } from "../../src/lib/tooling/session.js";

const AUTH = "https://auth.integration-layer.eu-central-1.aws.commercetools.com";

/** Stub global fetch with a single canned response, capturing the call. */
function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const sentBody = (calls: { init: RequestInit }[]) =>
  JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mintSession", () => {
  // The Commerce Integration Layer mounts the session router at `/:projectKey/session`
  // (apps/storefront/src/index.ts). An earlier version of this file posted to
  // `/token` — the storefront's OWN same-origin proxy route, not the integration
  // layer's — and every explorer start died on a 404. A stubbed fetch cannot tell
  // you the path is wrong, so this asserts the exact literal.
  it("posts to /<project>/session — NOT /<project>/token", async () => {
    const calls = stubFetch(200, { token: "anon-token" });

    const session = await mintSession(AUTH, "acme-b2b", { kind: "anonymous" });

    expect(session.token).toBe("anon-token");
    expect(session.describe).toBe("anonymous");
    expect(calls[0].url).toBe(`${AUTH}/acme-b2b/session`);
    expect(calls[0].url).not.toMatch(/\/token$/);
    expect(sentBody(calls)).toEqual({ grant_type: "anonymous" });
  });

  it("logs a customer in with an ORDINARY password grant — the storefront's own flow", async () => {
    const calls = stubFetch(200, { token: "customer-token" });

    const session = await mintSession(AUTH, "acme-b2b", {
      kind: "password",
      email: "alice@example.com",
      password: "hunter2",
    });

    expect(session.token).toBe("customer-token");
    expect(session.describe).toBe("customer alice@example.com");
    // The grant is exactly what a storefront sends — no impersonation, no act-as,
    // no operator-privileged debug header.
    expect(sentBody(calls)).toEqual({
      grant_type: "password",
      email: "alice@example.com",
      password: "hunter2",
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).toEqual(["content-type"]);
  });

  it("trims a trailing slash off the auth base so the URL never doubles up", async () => {
    const calls = stubFetch(200, { token: "t" });
    await mintSession(`${AUTH}/`, "p", { kind: "anonymous" });
    expect(calls[0].url).toBe(`${AUTH}/p/session`);
  });

  it("url-encodes the project key", async () => {
    const calls = stubFetch(200, { token: "t" });
    await mintSession(AUTH, "a/b", { kind: "anonymous" });
    expect(calls[0].url).toBe(`${AUTH}/a%2Fb/session`);
  });

  it("surfaces the Commerce Integration Layer's own error description, not a bare status", async () => {
    stubFetch(400, { error: "invalid_grant", error_description: "account not found" });

    await expect(
      mintSession(AUTH, "p", { kind: "password", email: "a@b.c", password: "x" }),
    ).rejects.toThrow(/account not found/);
  });

  it("names the identity it failed to mint, so a bad login reads differently to a bad edge", async () => {
    stubFetch(401, { error_description: "nope" });
    await expect(
      mintSession(AUTH, "p", { kind: "password", email: "a@b.c", password: "x" }),
    ).rejects.toThrow(/a session for a@b\.c/);

    stubFetch(503, "upstream down");
    await expect(mintSession(AUTH, "p", { kind: "anonymous" })).rejects.toThrow(
      /an anonymous session/,
    );
  });

  it("fails loudly when the response carries no token", async () => {
    stubFetch(200, { notAToken: true });
    await expect(mintSession(AUTH, "p", { kind: "anonymous" })).rejects.toThrow(/no `token`/);
  });
});

// Presentment is resolved ONCE, at mint — the GraphQL boundary reads locale/
// currency/country off the session and fails the request if any is absent, and
// there is no per-request override. So getting the mint body right is the only
// chance to explore a market other than the project's default.
describe("mintSession presentment", () => {
  it("sends NOTHING when no presentment is chosen, so the project's defaults apply", async () => {
    const calls = stubFetch(200, { token: "t" });

    const session = await mintSession(AUTH, "p", { kind: "anonymous" });

    expect(sentBody(calls)).toEqual({ grant_type: "anonymous" });
    expect(Object.keys(sentBody(calls))).not.toContain("locale");
    expect(session.presentment).toBe("project defaults");
  });

  it("passes an explicit selection through on the mint call", async () => {
    const calls = stubFetch(200, { token: "t" });

    const session = await mintSession(
      AUTH,
      "p",
      { kind: "anonymous" },
      { locale: "de-DE", currency: "EUR", country: "DE" },
    );

    expect(sentBody(calls)).toEqual({
      grant_type: "anonymous",
      locale: "de-DE",
      currency: "EUR",
      country: "DE",
    });
    expect(session.presentment).toBe("de-DE / EUR / DE");
  });

  it("lets one field be chosen without forcing the other two", async () => {
    // Each is independently defaulted by the Commerce Integration Layer, so `--currency EUR`
    // alone must not smuggle a made-up locale or country along with it.
    const calls = stubFetch(200, { token: "t" });

    const session = await mintSession(AUTH, "p", { kind: "anonymous" }, { currency: "EUR" });

    expect(sentBody(calls)).toEqual({ grant_type: "anonymous", currency: "EUR" });
    expect(session.presentment).toBe("project locale / EUR / project country");
  });

  it("upper-cases currency and country, but not locale, so the banner matches the session", async () => {
    const calls = stubFetch(200, { token: "t" });

    const session = await mintSession(
      AUTH,
      "p",
      { kind: "anonymous" },
      { locale: "de-DE", currency: "eur", country: "de" },
    );

    expect(sentBody(calls)).toEqual({
      grant_type: "anonymous",
      locale: "de-DE",
      currency: "EUR",
      country: "DE",
    });
    expect(session.presentment).toBe("de-DE / EUR / DE");
  });

  it("rides a customer login too, not just the anonymous grant", async () => {
    const calls = stubFetch(200, { token: "t" });

    await mintSession(
      AUTH,
      "p",
      { kind: "password", email: "a@b.c", password: "x" },
      { country: "DE" },
    );

    expect(sentBody(calls)).toEqual({
      grant_type: "password",
      email: "a@b.c",
      password: "x",
      country: "DE",
    });
  });
});
