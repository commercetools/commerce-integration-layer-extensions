import { afterEach, describe, expect, it, vi } from "vitest";

import IdpLoginDelete from "../../../src/commands/integration-layer/idp-login/delete.js";
import IdpLoginGet from "../../../src/commands/integration-layer/idp-login/get.js";
import IdpLoginSet from "../../../src/commands/integration-layer/idp-login/set.js";
import type { IlContext } from "../../../src/lib/base.js";

const BASE = "https://extensions.integration-layer.eu-central-1.aws.commercetools.com";
const PROJECT = "my-project";

const STORED = {
  issuer: "https://idp.example.com",
  tokenEndpoint: "https://idp.example.com/token",
  revocationEndpoint: "https://idp.example.com/revoke",
  jwksUri: "https://idp.example.com/jwks",
  clientId: "abc",
  redirectUri: "https://shop.example.com/callback",
  claims: {
    externalId: "sub",
    email: "mail",
    firstName: "given_name",
    lastName: "family_name",
    phone: "phone_number",
  },
  matchStrategy: "externalId",
  hasClientSecret: true,
};

const FULL_FLAGS = [
  "--issuer", "https://idp.example.com",
  "--token-endpoint", "https://idp.example.com/token",
  "--revocation-endpoint", "https://idp.example.com/revoke",
  "--jwks-uri", "https://idp.example.com/jwks",
  "--client-id", "abc",
  "--redirect-uri", "https://shop.example.com/callback",
];

async function runCommand(
  Command: typeof IdpLoginGet | typeof IdpLoginSet | typeof IdpLoginDelete,
  argv: string[],
  fetchImpl: typeof fetch,
): Promise<{ out: string; error?: Error }> {
  const ctx: IlContext = { baseUrl: BASE, projectKey: PROJECT, authFetch: fetchImpl };
  const proto = Command.prototype as unknown as {
    init: () => Promise<void>;
    resolveIlContext: () => Promise<IlContext>;
    log: (...a: unknown[]) => void;
  };
  const initSpy = vi.spyOn(proto, "init").mockResolvedValue(undefined);
  const ctxSpy = vi.spyOn(proto, "resolveIlContext").mockResolvedValue(ctx);
  const out: string[] = [];
  const logSpy = vi.spyOn(proto, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(" "));
  });
  let error: Error | undefined;
  try {
    await Command.run(argv);
  } catch (e) {
    error = e as Error;
  } finally {
    initSpy.mockRestore();
    ctxSpy.mockRestore();
    logSpy.mockRestore();
  }
  return { out: out.join("\n"), error };
}

/** GET → `stored` (or 404 when null); PUT echoes the body redacted; DELETE → 204. */
function idpFetch(stored: object | null) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      // The secret is never echoed; a stored one is assumed, as after a real save.
      const { clientSecret: _secret, ...rest } = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ...rest, hasClientSecret: true }), { status: 200 });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return stored
      ? new Response(JSON.stringify(stored), { status: 200 })
      : new Response("not found", { status: 404 });
  });
}

const asFetch = (f: ReturnType<typeof idpFetch>) => f as unknown as typeof fetch;
const putOf = (f: ReturnType<typeof idpFetch>) => f.mock.calls.find(([, i]) => i?.method === "PUT");

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.IDP_CLIENT_SECRET;
});

describe("integration-layer idp-login get", () => {
  it("prints the configuration without ever printing a secret", async () => {
    const { out, error } = await runCommand(IdpLoginGet, [], asFetch(idpFetch(STORED)));
    expect(error).toBeUndefined();
    expect(out).toContain("issuer:                  https://idp.example.com");
    expect(out).toContain("client secret:           set");
    expect(out).toContain("email: mail");
  });

  it("says so when nothing is configured", async () => {
    const { out } = await runCommand(IdpLoginGet, [], asFetch(idpFetch(null)));
    expect(out).toContain("No IdP login is configured");
  });
});

describe("integration-layer idp-login set", () => {
  it("creates a configuration with the default claims and externalId matching", async () => {
    const f = idpFetch(null);
    const { error, out } = await runCommand(
      IdpLoginSet,
      [...FULL_FLAGS, "--client-secret", "s3cret"],
      asFetch(f),
    );
    expect(error).toBeUndefined();
    const put = putOf(f)!;
    expect(put[0]).toBe(`${BASE}/${PROJECT}/main/idp`);
    expect(JSON.parse(String(put[1]?.body))).toEqual({
      issuer: "https://idp.example.com",
      tokenEndpoint: "https://idp.example.com/token",
      revocationEndpoint: "https://idp.example.com/revoke",
      jwksUri: "https://idp.example.com/jwks",
      clientId: "abc",
      clientSecret: "s3cret",
      redirectUri: "https://shop.example.com/callback",
      claims: {
        externalId: "sub",
        email: "email",
        firstName: "given_name",
        lastName: "family_name",
        phone: "phone_number",
      },
      matchStrategy: "externalId",
    });
    expect(out).toContain("configured IdP login");
    expect(out).not.toContain("s3cret");
  });

  it("lists everything missing on a first save", async () => {
    const f = idpFetch(null);
    const { error } = await runCommand(IdpLoginSet, ["--issuer", "https://idp.example.com"], asFetch(f));
    expect(error?.message).toMatch(/--token-endpoint.*--client-id.*--client-secret/);
    expect(putOf(f)).toBeUndefined();
  });

  it("updates only the passed fields and keeps the stored secret (sent as empty)", async () => {
    const f = idpFetch(STORED);
    const { error } = await runCommand(
      IdpLoginSet,
      ["--match-strategy", "email", "--claim-email", "upn"],
      asFetch(f),
    );
    expect(error).toBeUndefined();
    const body = JSON.parse(String(putOf(f)![1]?.body));
    expect(body.clientSecret).toBe("");
    expect(body.matchStrategy).toBe("email");
    expect(body.claims).toEqual({ ...STORED.claims, email: "upn" });
    expect(body.issuer).toBe(STORED.issuer);
  });

  it("reads the client secret from IDP_CLIENT_SECRET", async () => {
    process.env.IDP_CLIENT_SECRET = "from-env";
    const f = idpFetch(STORED);
    await runCommand(IdpLoginSet, ["--client-id", "new"], asFetch(f));
    const body = JSON.parse(String(putOf(f)![1]?.body));
    expect(body.clientSecret).toBe("from-env");
    expect(body.clientId).toBe("new");
  });

  it("clears the optional authorization endpoint with an empty value", async () => {
    const f = idpFetch({ ...STORED, authorizationEndpoint: "https://idp.example.com/auth" });
    await runCommand(IdpLoginSet, ["--authorization-endpoint", ""], asFetch(f));
    expect(JSON.parse(String(putOf(f)![1]?.body)).authorizationEndpoint).toBeUndefined();
  });

  it("rejects an empty required value", async () => {
    const f = idpFetch(STORED);
    const { error } = await runCommand(IdpLoginSet, ["--issuer", " "], asFetch(f));
    expect(error?.message).toMatch(/--issuer must not be empty/);
    expect(putOf(f)).toBeUndefined();
  });
});

describe("integration-layer idp-login delete", () => {
  it("DELETEs with --force", async () => {
    const f = idpFetch(STORED);
    const { out, error } = await runCommand(IdpLoginDelete, ["--force"], asFetch(f));
    expect(error).toBeUndefined();
    expect(f.mock.calls.some(([u, i]) => i?.method === "DELETE" && u === `${BASE}/${PROJECT}/main/idp`)).toBe(true);
    expect(out).toContain("removed IdP login");
  });

  it("does nothing when no IdP is configured", async () => {
    const f = idpFetch(null);
    const { out } = await runCommand(IdpLoginDelete, ["--force"], asFetch(f));
    expect(out).toContain("Nothing to remove");
    expect(f.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(false);
  });
});
