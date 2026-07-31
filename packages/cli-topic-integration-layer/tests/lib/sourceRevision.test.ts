import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_SOURCE_REVISION_LENGTH,
  detectGitRevision,
  resolveSourceRevision,
  sanitizeSourceRevision,
} from "../../src/lib/sourceRevision.js";

const exec = promisify(execFile);

// Detection runs real `git` against real throwaway repositories rather than stubbing
// the child process: the whole value of this feature is that it reports what the
// working copy ACTUALLY says, and a mocked `git describe` would pass no matter how
// wrong the arguments were.
async function git(cwd: string, ...args: string[]): Promise<void> {
  await exec("git", args, {
    cwd,
    env: {
      ...process.env,
      // Fully isolate from the developer's own git configuration: whoever runs these
      // tests may have `commit.gpgSign`, `tag.gpgSign`, hooks or templates set, any of
      // which would fail these commands for reasons that have nothing to do with the
      // code under test.
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

describe("sanitizeSourceRevision", () => {
  it("keeps real revisions and strips anything that isn't printable ASCII", () => {
    expect(sanitizeSourceRevision("v1.4.2-3-g1a2b3c4d-dirty")).toBe("v1.4.2-3-g1a2b3c4d-dirty");
    // Matching the server's rule keeps what the CLI PRINTS equal to what's stored.
    expect(sanitizeSourceRevision("v1\r\nX: 1")).toBe("v1X: 1");
    expect(sanitizeSourceRevision("a\u0000b\u2028c")).toBe("abc");
    expect(sanitizeSourceRevision("a".repeat(400))).toHaveLength(MAX_SOURCE_REVISION_LENGTH);
    expect(sanitizeSourceRevision("")).toBeUndefined();
    expect(sanitizeSourceRevision("  ")).toBeUndefined();
  });
});

describe("detectGitRevision", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ilc-source-revision-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null outside a git checkout", async () => {
    // A bundle built outside version control has no revision — reporting none beats
    // inventing one.
    expect(await detectGitRevision(dir)).toBeNull();
  });

  it("returns null for a repository with no commits yet", async () => {
    await git(dir, "init", "-q", "-b", "main");

    expect(await detectGitRevision(dir)).toBeNull();
  });

  it("reports the bare commit when the repository has no tags", async () => {
    await git(dir, "init", "-q", "-b", "main");
    await writeFile(join(dir, "extension.ts"), "export const typeDefs = '';\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "first");

    const revision = await detectGitRevision(dir);

    // `git describe --always` falls back to the abbreviated sha.
    expect(revision).toMatch(/^[0-9a-f]{7,12}$/);
  });

  it("prefers a tag over the raw commit, and reports distance from it", async () => {
    await git(dir, "init", "-q", "-b", "main");
    await writeFile(join(dir, "extension.ts"), "export const typeDefs = '';\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "first");
    await git(dir, "tag", "v1.4.2");

    // Exactly on the tag: the tag alone, which is what a human wants to see.
    expect(await detectGitRevision(dir)).toBe("v1.4.2");

    await writeFile(join(dir, "extension.ts"), "export const typeDefs = 'x';\n");
    await git(dir, "commit", "-q", "-am", "second");

    // Past the tag: tag + distance + commit, so it's still unambiguous.
    expect(await detectGitRevision(dir)).toMatch(/^v1\.4\.2-1-g[0-9a-f]{7,12}$/);
  });

  it("marks a modified working copy dirty", async () => {
    await git(dir, "init", "-q", "-b", "main");
    await writeFile(join(dir, "extension.ts"), "export const typeDefs = '';\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "first");
    await git(dir, "tag", "v1.4.2");
    await writeFile(join(dir, "extension.ts"), "export const typeDefs = 'edited';\n");

    // The bundle built here is NOT the tagged code, and the recorded revision has to
    // say so — otherwise a `-dirty` build looks identical to the release in the
    // Merchant Center.
    expect(await detectGitRevision(dir)).toBe("v1.4.2-dirty");
  });

  it("marks an UNTRACKED file dirty too (git describe --dirty would not)", async () => {
    await git(dir, "init", "-q", "-b", "main");
    await writeFile(join(dir, "extension.ts"), "export const typeDefs = '';\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "first");
    await git(dir, "tag", "v1.4.2");
    // An untracked module the entry point can import — esbuild bundles it, so the
    // artifact genuinely differs from the tagged commit. This is why the dirty check
    // is `status --porcelain` and not `describe --dirty`.
    await writeFile(join(dir, "helper.ts"), "export const x = 1;\n");

    expect(await detectGitRevision(dir)).toBe("v1.4.2-dirty");
  });

  it("ignores dirt outside the pushed directory", async () => {
    // A monorepo of examples: editing a sibling example must not mark this one dirty.
    await git(dir, "init", "-q", "-b", "main");
    const mine = join(dir, "mine");
    const other = join(dir, "other");
    await exec("mkdir", ["-p", mine, other]);
    await writeFile(join(mine, "extension.ts"), "export const typeDefs = '';\n");
    await writeFile(join(other, "extension.ts"), "export const typeDefs = '';\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "first");
    await git(dir, "tag", "v1.4.2");
    await writeFile(join(other, "extension.ts"), "export const typeDefs = 'edited';\n");

    expect(await detectGitRevision(mine)).toBe("v1.4.2");
    expect(await detectGitRevision(other)).toBe("v1.4.2-dirty");
  });
});

describe("resolveSourceRevision", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ilc-source-revision-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prefers an explicit value over detection — the non-git VCS path", async () => {
    await git(dir, "init", "-q", "-b", "main");
    await writeFile(join(dir, "extension.ts"), "export const typeDefs = '';\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "first");
    await git(dir, "tag", "v1.4.2");

    // hg/svn/Perforce/a CI build id: the Commerce Integration Layer stores an opaque string, so
    // the explicit flag covers every VCS without a detector per system.
    expect(await resolveSourceRevision("r48211", dir)).toBe("r48211");
  });

  it("sanitizes an explicit value", async () => {
    expect(await resolveSourceRevision("r1\r\nX: 1", dir)).toBe("r1X: 1");
  });

  it("falls back to detection, then to nothing", async () => {
    expect(await resolveSourceRevision(undefined, dir)).toBeUndefined();

    await git(dir, "init", "-q", "-b", "main");
    await writeFile(join(dir, "extension.ts"), "export const typeDefs = '';\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "first");
    await git(dir, "tag", "v2.0.0");

    expect(await resolveSourceRevision(undefined, dir)).toBe("v2.0.0");
  });
});
