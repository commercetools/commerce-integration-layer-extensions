import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  authEdgeUrlForRegion,
  edgeUrlForRegion,
  graphqlEdgeUrlForRegion,
  loadPersistedPrincipal,
} from "../../src/lib/base.js";

describe("edgeUrlForRegion", () => {
  it("derives the production extensions edge from the login region", () => {
    // A login against an AWS EU project resolves to the AWS EU production IL host —
    // same `<svc>.<region>.commercetools.com` convention as the CT API.
    expect(edgeUrlForRegion("eu-central-1.aws")).toBe(
      "https://extensions.integration-layer.eu-central-1.aws.commercetools.com",
    );
  });

  it("works for any commercetools region string", () => {
    expect(edgeUrlForRegion("europe-west1.gcp")).toBe(
      "https://extensions.integration-layer.europe-west1.gcp.commercetools.com",
    );
    expect(edgeUrlForRegion("us-central1.gcp")).toBe(
      "https://extensions.integration-layer.us-central1.gcp.commercetools.com",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(edgeUrlForRegion("  eu-central-1.aws  ")).toBe(
      "https://extensions.integration-layer.eu-central-1.aws.commercetools.com",
    );
  });

  it("returns undefined for an absent region (so resolveIlContext fails loudly)", () => {
    expect(edgeUrlForRegion("")).toBeUndefined();
    expect(edgeUrlForRegion("   ")).toBeUndefined();
  });
});

// The explorer talks to THREE different hosts, and conflating them is the easy
// mistake: the extensions edge serves the manage_project routes, the graphql edge
// serves operations (the router), and the auth edge mints sessions. They are served
// on separate ingresses.
describe("graphqlEdgeUrlForRegion", () => {
  it("derives the router host — NOT the extensions host", () => {
    expect(graphqlEdgeUrlForRegion("eu-central-1.aws")).toBe(
      "https://graphql.integration-layer.eu-central-1.aws.commercetools.com",
    );
    expect(graphqlEdgeUrlForRegion("eu-central-1.aws")).not.toBe(
      edgeUrlForRegion("eu-central-1.aws"),
    );
  });

  it("returns undefined for an absent region so the command fails loudly", () => {
    expect(graphqlEdgeUrlForRegion("")).toBeUndefined();
    expect(graphqlEdgeUrlForRegion("   ")).toBeUndefined();
  });
});

describe("authEdgeUrlForRegion", () => {
  it("derives the identity host, distinct from both others", () => {
    expect(authEdgeUrlForRegion("europe-west1.gcp")).toBe(
      "https://auth.integration-layer.europe-west1.gcp.commercetools.com",
    );
    const region = "europe-west1.gcp";
    expect(
      new Set([
        edgeUrlForRegion(region),
        graphqlEdgeUrlForRegion(region),
        authEdgeUrlForRegion(region),
      ]).size,
    ).toBe(3);
  });

  it("returns undefined for an absent region so the command fails loudly", () => {
    expect(authEdgeUrlForRegion("")).toBeUndefined();
  });
});

// The regression that motivated reading credentials from disk: when the topic is
// installed via `oclif plugins install`, it loads its OWN copy of `cli-plugin-auth`,
// whose in-memory `SecurityContextHolder` static is never filled by the host's
// `auth login`. Reconstructing the principal from the on-disk credentials file — which
// `auth login` DID write — sidesteps that duplicate-module split entirely. These tests
// pin the on-disk contract (path shape, auth id, serialized fields) the host CLI's
// `providers.ts` defines and that this topic now reads back independently.
describe("loadPersistedPrincipal", () => {
  let dir: string;
  let credentialsFile: string;

  // The exact JSON `auth login` persists for a client-credentials login, mirroring
  // `CtpClientAuthenticationToken.Serializable.serialize`.
  const validCredentials = {
    authentication: "client-credentials",
    clientId: "client-abc",
    clientSecret: "secret-xyz",
    projectKey: "my-project",
    scope: "manage_project:my-project",
    region: "eu-central-1.aws",
    accessToken: "the-access-token",
    refreshToken: null,
    issuedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_172_000,
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "il-creds-"));
    credentialsFile = path.join(dir, "credentials");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reconstructs the logged-in principal from the credentials file — no network", async () => {
    await writeFile(credentialsFile, JSON.stringify(validCredentials), "utf8");

    const principal = await loadPersistedPrincipal(credentialsFile);

    // Exactly the fields resolveIlContext / explore read off the principal.
    expect(principal).toBeDefined();
    expect(principal?.getAccessToken().getTokenValue()).toBe("the-access-token");
    expect(principal?.getRegion()).toBe("eu-central-1.aws");
    expect(principal?.getProjectKey()).toBe("my-project");
  });

  it("returns undefined when no credentials file exists (so unauthorized commands still run)", async () => {
    expect(await loadPersistedPrincipal(credentialsFile)).toBeUndefined();
  });
});
