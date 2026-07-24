import { describe, expect, it } from "vitest";

import { edgeUrlForRegion } from "../../src/lib/base.js";

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
