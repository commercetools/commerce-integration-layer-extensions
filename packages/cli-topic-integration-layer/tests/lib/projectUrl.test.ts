import { describe, expect, it } from "vitest";

import { projectUrl } from "../../src/lib/projectUrl.js";

describe("projectUrl", () => {
  it("puts the main instance segment after the project key", () => {
    expect(projectUrl("https://edge.example", "acme")).toBe("https://edge.example/acme/main");
  });

  it("strips trailing slashes from the base", () => {
    expect(projectUrl("https://edge.example//", "acme")).toBe("https://edge.example/acme/main");
  });

  it("encodes the project key", () => {
    expect(projectUrl("https://edge.example", "a/b")).toBe("https://edge.example/a%2Fb/main");
  });
});
