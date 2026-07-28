// Wait for a just-pushed bundle version to prove itself.
//
// A push only STORES a bundle. The extension picks it up on its own poll, tries to
// load it, and reports back — so the version starts `pending` and only becomes
// `running` (it loaded and published its schema) or `failed` (it didn't, with a
// reason) a little later. Until this, `push` reported success the moment the bytes
// landed, which meant a bundle the sandbox refuses to run looked like a clean push.
//
// This polls the project's bundle metadata until the pushed version settles, and
// hands the caller back an outcome it can turn into an exit code.
//
// Three things it deliberately does NOT do:
//
//   - It never treats "I couldn't find out" as a failure. An integration layer that
//     predates bundle state reports no `state` at all, and a project whose extension
//     isn't deployed yet will never move off `pending`. Both are `unknown`, not
//     `failed` — failing a push for them would break perfectly good workflows.
//   - It doesn't watch for the version to change under it. If someone else pushes
//     while we wait, the newest version is no longer ours; we say so and stop rather
//     than report on somebody else's push.
//   - It doesn't retry transient metadata-read errors into a verdict. A read that
//     throws ends the wait as `unknown` with the error attached.

import { fetchExtensionMeta, type ExtensionMeta } from "./ilClient.js";

/** How the wait ended. Only `failed` means "the push produced a broken bundle". */
export type BundleOutcome =
  | { kind: "running"; meta: ExtensionMeta }
  | { kind: "failed"; meta: ExtensionMeta }
  | { kind: "superseded"; meta: ExtensionMeta }
  | { kind: "unknown"; reason: string; meta?: ExtensionMeta };

export interface AwaitOptions {
  /** Give up after this long. */
  timeoutMs: number;
  /** Gap between metadata reads. */
  intervalMs: number;
  /** Injected so tests don't actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so tests control elapsed time. */
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until `version` leaves `pending`, or we run out of time.
 *
 * The first read happens immediately — an extension that was already mid-poll can
 * settle the version before we ever sleep.
 */
export async function awaitBundleState(
  baseUrl: string,
  projectKey: string,
  token: string,
  version: number,
  options: AwaitOptions,
): Promise<BundleOutcome> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;

  for (;;) {
    let meta: ExtensionMeta | null;
    try {
      meta = await fetchExtensionMeta(baseUrl, projectKey, token);
    } catch (err) {
      return {
        kind: "unknown",
        reason: `could not read the stored bundle's status: ${(err as Error).message}`,
      };
    }

    if (meta === null) {
      // Deleted out from under us between the push and this read.
      return { kind: "unknown", reason: "no bundle is stored for this project any more" };
    }
    if (meta.state === undefined) {
      // An integration layer that doesn't report state. Nothing to wait for.
      return {
        kind: "unknown",
        reason: "this integration layer does not report bundle status",
        meta,
      };
    }
    if (meta.version !== version) {
      // Someone else pushed while we were waiting; the newest version isn't ours.
      return { kind: "superseded", meta };
    }
    if (meta.state === "running") return { kind: "running", meta };
    if (meta.state === "failed") return { kind: "failed", meta };

    // Still pending.
    if (now() >= deadline) {
      return {
        kind: "unknown",
        reason: `the extension did not report on version ${version} within ${Math.round(
          options.timeoutMs / 1000,
        )}s`,
        meta,
      };
    }
    await sleep(options.intervalMs);
  }
}
