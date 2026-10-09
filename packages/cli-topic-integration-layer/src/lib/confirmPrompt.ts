import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * Ask a yes/no question. Skipped (true) when `force` is set; refuses non-interactive
 * runs without it, so a pipeline must opt in explicitly.
 */
export async function confirm(opts: {
  question: string;
  force: boolean;
  /** Shown before the question — only when a confirmation is actually needed. */
  preview?: () => void;
  abort: (message: string) => never;
}): Promise<boolean> {
  if (opts.force) return true;
  opts.preview?.();
  if (!stdin.isTTY) {
    opts.abort("Refusing to continue without a TTY — re-run with --force to skip confirmation.");
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${opts.question} (y/N) `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
