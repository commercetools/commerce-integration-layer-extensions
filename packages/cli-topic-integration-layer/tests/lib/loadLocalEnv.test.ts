import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  envFilePathFromArgv,
  loadLocalEnv,
  parseEnvFile,
  resolveEnvFileLocation,
  watchEnvFile,
} from "../../src/lib/loadLocalEnv.js";
import { extensionConfigFromEnv } from "../../src/lib/extensionConfig.js";

const flush = (ms = 200): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("envFilePathFromArgv", () => {
  it("reads --env-file <path> and --env-file=<path>", () => {
    expect(envFilePathFromArgv(["node", "cli", "--env-file", ".env.local"])).toBe(".env.local");
    expect(envFilePathFromArgv(["node", "cli", "--env-file=.env.staging"])).toBe(".env.staging");
  });

  it("returns undefined when the flag is absent", () => {
    expect(envFilePathFromArgv(["node", "cli", "extension", "serve"])).toBeUndefined();
  });

  it("fails loudly when --env-file has no path", () => {
    expect(() => envFilePathFromArgv(["node", "cli", "--env-file"])).toThrow(/requires a path/);
    expect(() => envFilePathFromArgv(["node", "cli", "--env-file="])).toThrow(/requires a path/);
    expect(() => envFilePathFromArgv(["node", "cli", "--env-file", "--gateway"])).toThrow(
      /requires a path/,
    );
  });
});

describe("resolveEnvFileLocation", () => {
  it("defaults to an optional .env in the cwd", () => {
    expect(resolveEnvFileLocation({ cwd: "/tmp/x", argv: ["node", "cli"] })).toEqual({
      path: resolve("/tmp/x", ".env"),
      required: false,
    });
  });

  it("marks an explicit --env-file as required", () => {
    expect(
      resolveEnvFileLocation({ cwd: "/tmp/x", argv: ["node", "cli", "--env-file", "e.env"] }),
    ).toEqual({ path: resolve("/tmp/x", "e.env"), required: true });
  });
});

describe("loadLocalEnv", () => {
  const keys = ["IL_TEST_FROM_FILE", "IL_TEST_ALREADY_SET"] as const;
  let dir: string;

  afterEach(async () => {
    for (const key of keys) delete process.env[key];
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("loads .env from cwd without overriding existing env", async () => {
    dir = await mkdtemp(join(tmpdir(), "il-cli-env-"));
    await writeFile(
      join(dir, ".env"),
      "IL_TEST_FROM_FILE=from-file\nIL_TEST_ALREADY_SET=from-file\n",
      "utf8",
    );
    process.env.IL_TEST_ALREADY_SET = "from-shell";

    const loaded = loadLocalEnv({ cwd: dir, argv: ["node", "cli"] });
    expect(loaded).toBe(join(dir, ".env"));
    expect(process.env.IL_TEST_FROM_FILE).toBe("from-file");
    expect(process.env.IL_TEST_ALREADY_SET).toBe("from-shell");
  });

  it("is a no-op when default .env is missing", () => {
    expect(loadLocalEnv({ cwd: tmpdir(), argv: ["node", "cli"] })).toBeUndefined();
  });

  it("fails loudly when --env-file points at a missing file", async () => {
    dir = await mkdtemp(join(tmpdir(), "il-cli-env-"));
    expect(() =>
      loadLocalEnv({ cwd: dir, argv: ["node", "cli", "--env-file", "missing.env"] }),
    ).toThrow(/ENOENT|no such file/i);
  });
});

describe("parseEnvFile", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("parses a dotenv file without touching process.env", async () => {
    dir = await mkdtemp(join(tmpdir(), "il-cli-env-"));
    const file = join(dir, ".env");
    await writeFile(file, "EXTENSION_CONFIG_A=1\n# comment\nEXTENSION_CONFIG_B=two=parts\n", "utf8");
    expect(parseEnvFile(file)).toEqual({
      EXTENSION_CONFIG_A: "1",
      EXTENSION_CONFIG_B: "two=parts",
    });
    expect(process.env.EXTENSION_CONFIG_A).toBeUndefined();
  });

  it("returns {} for a missing file", () => {
    expect(parseEnvFile(join(tmpdir(), "does-not-exist.env"))).toEqual({});
  });
});

describe("watchEnvFile", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("fires onChange after the file is written", async () => {
    dir = await mkdtemp(join(tmpdir(), "il-cli-env-"));
    const file = join(dir, ".env");
    await writeFile(file, "EXTENSION_CONFIG_A=1\n", "utf8");

    let fired = 0;
    const stop = watchEnvFile(file, () => {
      fired++;
    });
    try {
      await writeFile(file, "EXTENSION_CONFIG_A=2\n", "utf8");
      await flush();
      expect(fired).toBeGreaterThanOrEqual(1);
    } finally {
      stop();
    }
  });

  it("returns a no-op stop for an unwatchable directory", () => {
    const stop = watchEnvFile("/no/such/dir/.env", () => {});
    expect(() => stop()).not.toThrow();
  });
});

describe("extensionConfigFromEnv", () => {
  it("maps EXTENSION_CONFIG_* into ctx.config keys and drops the bare prefix", () => {
    expect(
      extensionConfigFromEnv({
        EXTENSION_CONFIG_ALGOLIA_API_KEY: "secret",
        EXTENSION_CONFIG_GREETING: "Hi",
        EXTENSION_CONFIG_: "dropped",
        OTHER: "ignored",
      }),
    ).toEqual({ ALGOLIA_API_KEY: "secret", GREETING: "Hi" });
  });
});
