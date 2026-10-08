import { describe, expect, it } from "vitest";

import type { ProjectPresentment } from "../../src/lib/ilClient.js";
import { canonicalisePresentment } from "../../src/lib/presentment.js";

const PRESENTMENT: ProjectPresentment = {
  languages: ["en-US", "de-DE"],
  countries: ["US", "DE"],
  currencies: ["USD", "EUR"],
};

describe("canonicalisePresentment", () => {
  it("returns the project's own spelling, matched case-insensitively", () => {
    expect(canonicalisePresentment(PRESENTMENT, "p", "country", "de")).toBe("DE");
    expect(canonicalisePresentment(PRESENTMENT, "p", "language", "EN-us")).toBe("en-US");
  });

  it("names what the project presents when the value is not on the list", () => {
    expect(() => canonicalisePresentment(PRESENTMENT, "p", "currency", "GBP")).toThrow(
      "Project 'p' does not present currency 'GBP'. It presents: USD, EUR.",
    );
  });
});
