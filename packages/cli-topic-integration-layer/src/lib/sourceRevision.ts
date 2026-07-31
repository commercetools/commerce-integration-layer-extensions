// Where the bundle being pushed came from — the integrator's OWN version-control
// revision, recorded against the stored bundle by the Commerce Integration Layer.
//
// The point is provenance: with this, the Merchant Center shows which revision a
// project is running, the connector stamps it on every log line, and
// `{ _extensionBundle { sourceRevision } }` answers it over GraphQL. So the default
// has to be zero-effort — `extension push` reads the working copy and reports what
// it finds, with no flag.
//
// GIT is auto-detected because that's what the examples and (nearly) every
// integrator use. Any other VCS — hg, svn, Perforce, a CI build id — is supported
// through `--source-revision` / `EXTENSION_SOURCE_REVISION` rather than a detector
// per system: the Commerce Integration Layer treats the value as an OPAQUE string, so
// whatever identifies a revision to the integrator is the right thing to send.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Longest revision the Commerce Integration Layer stores — it truncates past this. Applied
 * here too so what the CLI prints is what actually gets stored, rather than a value
 * the server silently shortens.
 */
export const MAX_SOURCE_REVISION_LENGTH = 200;

/**
 * Reduce a revision to printable ASCII, length-capped — matching the integration
 * layer's own rule, so the CLI never reports a value different from the stored one.
 * (The server sanitizes regardless; it doesn't trust its callers. This is about
 * telling the user the truth.)
 */
export function sanitizeSourceRevision(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[^\x20-\x7e]/g, "")
    .trim()
    .slice(0, MAX_SOURCE_REVISION_LENGTH);
  return cleaned || undefined;
}

// Run a git command in `cwd`, or return null if git isn't available, this isn't a
// repository, or the command has nothing to say. Provenance is a nice-to-have on a
// push: never fail the push over it.
async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec("git", args, { cwd, windowsHide: true });
    const trimmed = stdout.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

/**
 * The git revision describing `cwd`'s working copy, or null when it isn't a git
 * checkout.
 *
 * `git describe --tags --always` gives the most human-meaningful identifier
 * available, in decreasing order of usefulness: an exact tag (`v1.4.2`), a tag plus
 * distance and commit (`v1.4.2-3-g1a2b3c4d`), or — with no tags at all — the bare
 * commit (`1a2b3c4d`). That single command therefore covers "commit hash or tag"
 * without the caller choosing.
 *
 * A `-dirty` suffix is appended from `git status --porcelain -- .` rather than
 * `describe --dirty`, because `--dirty` ignores UNTRACKED files — and an untracked
 * source file that the entry point imports is bundled into the artifact, so a build
 * containing it is genuinely not the tagged commit. Scoped to `-- .` so it reflects
 * the directory being pushed, not unrelated edits elsewhere in a monorepo.
 */
export async function detectGitRevision(cwd: string): Promise<string | null> {
  // Cheapest possible "is this a git checkout?" probe — everything below is
  // pointless outside one, and this keeps a non-git working copy silent rather than
  // noisy.
  if (!(await git(["rev-parse", "--git-dir"], cwd))) return null;

  const described = await git(["describe", "--tags", "--always", "--abbrev=12"], cwd);
  // A repository with no commits yet describes to nothing — there is no revision to
  // report, so report none.
  if (!described) return null;

  const dirt = await git(["status", "--porcelain", "--", "."], cwd);
  return dirt ? `${described}-dirty` : described;
}

/**
 * The source revision to record for this push: the explicit value if the caller gave
 * one, else whatever the working copy says, else nothing.
 *
 * Nothing is a legitimate outcome — a bundle built outside version control has no
 * revision, and inventing one ("unknown", a timestamp) would put a value in the
 * Merchant Center and in every connector log line that means nothing.
 */
export async function resolveSourceRevision(
  explicit: string | undefined,
  cwd: string,
): Promise<string | undefined> {
  if (explicit !== undefined) return sanitizeSourceRevision(explicit);
  return sanitizeSourceRevision((await detectGitRevision(cwd)) ?? undefined);
}
