import { afterEach, describe, expect, it, vi } from "vitest";

import { confirmAllowlistChange, formatAllowlist } from "../../src/lib/allowlistPrompt.js";

describe("formatAllowlist", () => {
  it("renders (none) for an empty list", () => {
    expect(formatAllowlist([])).toBe("(none)");
  });

  it("joins hosts for a non-empty list", () => {
    expect(formatAllowlist(["api.foo.com", "*.bar.net"])).toBe("api.foo.com, *.bar.net");
  });
});

describe("confirmAllowlistChange", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips the prompt when force is true", async () => {
    const log = vi.fn();
    const abort = vi.fn((message: string): never => {
      throw new Error(message);
    });

    await expect(
      confirmAllowlistChange({
        projectKey: "demo",
        action: "set",
        current: ["old.example.com"],
        next: ["new.example.com"],
        force: true,
        log,
        abort,
      }),
    ).resolves.toBe(true);

    expect(log).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it("aborts non-interactive runs without force", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const abort = vi.fn((message: string): never => {
      throw new Error(message);
    });

    try {
      await expect(
        confirmAllowlistChange({
          projectKey: "demo",
          action: "remove",
          current: ["api.foo.com"],
          next: [],
          force: false,
          log: vi.fn(),
          abort,
        }),
      ).rejects.toThrow(/without a TTY/);

      expect(abort).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });
});
