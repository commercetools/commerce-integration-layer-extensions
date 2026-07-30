import { describe, expect, it } from "vitest";

import {
  authEdgeUrlForRegion,
  edgeUrlForRegion,
  graphqlEdgeUrlForRegion,
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
// mistake: the extensions edge serves manage_project routes (connector backend),
// the graphql edge serves operations (the router), and the auth edge mints sessions
// (the storefront pod). The four-pod split put them on separate ingresses.
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
