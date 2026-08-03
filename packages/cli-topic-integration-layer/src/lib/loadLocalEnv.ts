import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";

const ENV_FILE_FLAG = "--env-file";

/** Where a command's dotenv file is, and whether a missing file is an error. */
export interface EnvFileLocation {
  /** Absolute path to the dotenv file. */
  path: string;
  /** True when an explicit `--env-file` was given, so a missing file must fail loudly. */
  required: boolean;
}

/**
 * Peek argv for `--env-file <path>` / `--env-file=<path>` before oclif parses flags.
 * Must run in `init()` so values (e.g. `INTEGRATION_LAYER_URL`, `EXTENSION_CONFIG_*`)
 * are in `process.env` when flag `env:` bindings resolve.
 */
export function envFilePathFromArgv(argv: readonly string[] = process.argv): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === ENV_FILE_FLAG) {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`${ENV_FILE_FLAG} requires a path`);
      }
      return next;
    }
    if (arg.startsWith(`${ENV_FILE_FLAG}=`)) {
      const value = arg.slice(ENV_FILE_FLAG.length + 1);
      if (!value) throw new Error(`${ENV_FILE_FLAG} requires a path`);
      return value;
    }
  }
  return undefined;
}

/**
 * Resolve which dotenv file a command should read: an explicit `--env-file <path>`
 * (required — a missing one is an error) or, failing that, `.env` in the cwd (optional).
 */
export function resolveEnvFileLocation(options?: {
  argv?: readonly string[];
  cwd?: string;
}): EnvFileLocation {
  const cwd = options?.cwd ?? process.cwd();
  const fromArgv = envFilePathFromArgv(options?.argv ?? process.argv);
  return {
    path: path.resolve(cwd, fromArgv ?? ".env"),
    required: fromArgv !== undefined,
  };
}

/**
 * Load a dotenv file into `process.env` without overriding existing keys
 * (Node's `process.loadEnvFile` semantics).
 *
 * - `--env-file <path>` (from argv): required; a missing file fails loudly.
 * - otherwise `.env` in cwd: optional; a missing file is a no-op.
 *
 * Returns the absolute path that was loaded, or `undefined` when nothing was loaded.
 */
export function loadLocalEnv(options?: {
  argv?: readonly string[];
  cwd?: string;
}): string | undefined {
  const { path: filePath, required } = resolveEnvFileLocation(options);
  try {
    process.loadEnvFile(filePath);
    return filePath;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!required && code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * Parse a dotenv file into a plain object WITHOUT touching `process.env`. Returns an
 * empty object when the file is absent — the caller decides whether that's an error.
 * Used by the `serve` hot-reload path, which needs the file's current values on each
 * change (unlike {@link loadLocalEnv}, whose "existing env wins" load can't re-apply an
 * edited value already present in `process.env`).
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  return parseEnv(source) as Record<string, string>;
}

/**
 * Watch a dotenv file for changes and invoke `onChange` (debounced) after each write.
 * Watches the containing DIRECTORY, not the file, so it survives editors that save via
 * atomic rename (which swaps the inode and would silently kill a file-level watch) and
 * catches the file being created after the server starts. Returns a stop function.
 */
export function watchEnvFile(filePath: string, onChange: () => void): () => void {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher;
  try {
    watcher = watch(dir, (_event, changed) => {
      // `changed` is null on some platforms; fall back to firing on any dir event.
      if (changed !== null && changed !== base) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, 50);
    });
  } catch {
    // A missing/unwatchable directory just means no hot-reload; not fatal.
    return () => {};
  }
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
