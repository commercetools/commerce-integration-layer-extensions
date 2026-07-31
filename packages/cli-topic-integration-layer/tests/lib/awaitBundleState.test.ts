// Spec for the post-push wait.
//
// A push only stores a bundle; the extension loads it on its own poll and reports
// back. These pin the outcomes `push` turns into an exit code — above all the two
// that matter: a version that loads is a success, and a version the sandbox refuses
// to run is a FAILURE the command must not exit 0 on.
//
// The line these tests hold is that "couldn't find out" is never "failed". An older
// integration layer, an extension that isn't deployed, a metadata read that errored
// — none of those mean the bundle is broken, and failing a push for them would break
// workflows that never had this signal at all.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { awaitBundleState } from "../../src/lib/awaitBundleState.js";
import type { ExtensionMeta } from "../../src/lib/ilClient.js";

const BASE = "https://il.test";
const PROJECT = "demo-project";
const TOKEN = "t";

function meta(over: Partial<ExtensionMeta> = {}): ExtensionMeta {
  return {
    projectKey: PROJECT,
    length: 10,
    uploadedAt: 0,
    version: 7,
    state: "pending",
    ...over,
  };
}

// A fake clock, so a "timeout" test doesn't actually wait. Each sleep advances it.
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

/** Queue of successive metadata reads; the last entry repeats once exhausted. */
function stubMeta(responses: (ExtensionMeta | null)[]) {
  let i = 0;
  return vi.fn(async () => {
    const value = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return value;
  });
}

let fetchExtensionMetaMock: ReturnType<typeof stubMeta>;

vi.mock("../../src/lib/ilClient.js", () => ({
  fetchExtensionMeta: (...args: unknown[]) => fetchExtensionMetaMock(...(args as [])),
}));

const clock = fakeClock;
const OPTS = { timeoutMs: 60_000, intervalMs: 5000 };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("awaitBundleState", () => {
  it("resolves running once the extension has loaded the pushed version", async () => {
    const c = clock();
    fetchExtensionMetaMock = stubMeta([
      meta({ state: "pending" }),
      meta({ state: "running", served: { version: 7, sourceRevision: "1a2b3c4" } }),
    ]);

    const outcome = await awaitBundleState(BASE, PROJECT, TOKEN, 7, { ...OPTS, ...c });

    expect(outcome.kind).toBe("running");
    // It polled rather than giving up on the first pending read.
    expect(fetchExtensionMetaMock).toHaveBeenCalledTimes(2);
  });

  // THE ONE THAT MATTERS: a bundle the sandbox refuses must be a failure, carrying
  // the reason and what's still in use so the operator knows the project didn't die.
  it("resolves failed with the reason and the version still in use", async () => {
    const c = clock();
    fetchExtensionMetaMock = stubMeta([
      meta({
        state: "failed",
        reason: 'may not require "fs"',
        sourceRevision: "1a2b3c4",
        served: { version: 6, sourceRevision: "9f8e7d6" },
      }),
    ]);

    const outcome = await awaitBundleState(BASE, PROJECT, TOKEN, 7, { ...OPTS, ...c });

    // Both builds are carried through, each with its commit — push renders them.
    expect(outcome).toMatchObject({
      kind: "failed",
      meta: {
        reason: 'may not require "fs"',
        sourceRevision: "1a2b3c4",
        served: { version: 6, sourceRevision: "9f8e7d6" },
      },
    });
  });

  it("treats an integration layer that reports no state as unknown, not failed", async () => {
    const c = clock();
    // `state` absent entirely — an older deployment.
    fetchExtensionMetaMock = stubMeta([{ ...meta(), state: undefined }]);

    const outcome = await awaitBundleState(BASE, PROJECT, TOKEN, 7, { ...OPTS, ...c });

    expect(outcome.kind).toBe("unknown");
    // Answered on the first read — there is nothing to wait for.
    expect(fetchExtensionMetaMock).toHaveBeenCalledTimes(1);
  });

  it("gives up as unknown when the version never leaves pending", async () => {
    const c = clock();
    fetchExtensionMetaMock = stubMeta([meta({ state: "pending" })]);

    const outcome = await awaitBundleState(BASE, PROJECT, TOKEN, 7, {
      timeoutMs: 20_000,
      intervalMs: 5000,
      ...c,
    });

    expect(outcome.kind).toBe("unknown");
    if (outcome.kind === "unknown") {
      expect(outcome.reason).toMatch(/did not report on version 7 within 20s/);
    }
    // Bounded: it stopped at the deadline rather than polling forever.
    expect(fetchExtensionMetaMock.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("stops without a verdict when another push supersedes ours", async () => {
    const c = clock();
    fetchExtensionMetaMock = stubMeta([meta({ version: 8, state: "running" })]);

    const outcome = await awaitBundleState(BASE, PROJECT, TOKEN, 7, { ...OPTS, ...c });

    // We must not report someone else's push as our result — in either direction.
    expect(outcome).toMatchObject({ kind: "superseded", meta: { version: 8 } });
  });

  it("treats a metadata read error as unknown rather than a failed bundle", async () => {
    const c = clock();
    fetchExtensionMetaMock = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const outcome = await awaitBundleState(BASE, PROJECT, TOKEN, 7, { ...OPTS, ...c });

    expect(outcome.kind).toBe("unknown");
    if (outcome.kind === "unknown") {
      expect(outcome.reason).toMatch(/ECONNREFUSED/);
    }
  });

  it("treats a bundle deleted while we waited as unknown", async () => {
    const c = clock();
    fetchExtensionMetaMock = stubMeta([null]);

    const outcome = await awaitBundleState(BASE, PROJECT, TOKEN, 7, { ...OPTS, ...c });

    expect(outcome.kind).toBe("unknown");
  });
});
