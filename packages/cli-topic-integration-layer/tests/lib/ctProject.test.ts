import { describe, expect, it, vi } from "vitest";

import {
  canonicalisePresentment,
  fetchProjectPresentment,
  type ProjectPresentment,
} from "../../src/lib/ctProject.js";

const PRESENTMENT: ProjectPresentment = {
  languages: ["en-US", "de-DE"],
  countries: ["US", "DE"],
  currencies: ["USD", "EUR"],
};

describe("fetchProjectPresentment", () => {
  it("GETs the project resource on the platform API for the login region", async () => {
    const authFetch = vi.fn(async (_url: unknown) => new Response(JSON.stringify({ ...PRESENTMENT, key: "p" }), { status: 200 }));
    const result = await fetchProjectPresentment("eu-central-1.aws", "my-project", authFetch as unknown as typeof fetch);
    expect(result).toEqual(PRESENTMENT);
    expect(authFetch.mock.calls[0]![0]).toBe("https://api.eu-central-1.aws.commercetools.com/my-project");
  });

  it("throws with the status + body on a non-2xx response", async () => {
    const authFetch = vi.fn(async () => new Response("nope", { status: 403 }));
    await expect(fetchProjectPresentment("eu-central-1.aws", "p", authFetch as unknown as typeof fetch)).rejects.toThrow(/403.*nope/);
  });

  it("treats a missing list as a broken read, not an empty project", async () => {
    const authFetch = vi.fn(async () => new Response(JSON.stringify({ languages: [], countries: [] }), { status: 200 }));
    await expect(fetchProjectPresentment("eu-central-1.aws", "p", authFetch as unknown as typeof fetch)).rejects.toThrow(
      /no languages\/countries\/currencies/,
    );
  });
});

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
