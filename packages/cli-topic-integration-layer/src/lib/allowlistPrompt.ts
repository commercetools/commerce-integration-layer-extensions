import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/** One-line summary of an allow list for confirmation output. */
export function formatAllowlist(hosts: readonly string[]): string {
  return hosts.length === 0 ? "(none)" : hosts.join(", ");
}

export type AllowlistChangeAction = "set" | "remove";

/**
 * Show current vs proposed allow lists and ask for confirmation. Skipped when
 * `force` is true. Refuses non-interactive runs without `force`.
 */
export async function confirmAllowlistChange(opts: {
  projectKey: string;
  action: AllowlistChangeAction;
  current: readonly string[];
  next: readonly string[];
  force: boolean;
  log: (line: string) => void;
  abort: (message: string) => never;
}): Promise<boolean> {
  if (opts.force) return true;

  opts.log(`Project '${opts.projectKey}' — allowlist ${opts.action}:`);
  opts.log(`  Current: ${formatAllowlist(opts.current)}`);
  opts.log(`  After:   ${formatAllowlist(opts.next)}`);
  opts.log("");

  if (!stdin.isTTY) {
    opts.abort("Refusing to change the allowlist without a TTY — re-run with --force to skip confirmation.");
  }

  const verb = opts.action === "set" ? "replace the allowlist" : "remove these hosts";
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`Proceed to ${verb}? (y/N) `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
