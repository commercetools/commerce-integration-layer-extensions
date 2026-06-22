// Bundle an extension source into a single self-contained CommonJS artifact.
//
// esbuild bundles local helper modules inline. The output is CommonJS so the runtime
// can evaluate it as a script and read `module.exports`. `platform: "neutral"` keeps
// Node built-ins out (an import of one fails the build, not at load time), and
// `conditions: ["worker"]` steers a bundled SDK to its fetch-based build (the runtime
// provides a global `fetch`, not Node `http`/`https`). `graphql` stays EXTERNAL — the
// runtime supplies its single instance; a second inlined copy would break its
// `instanceof` checks.
//
// Entry/outfile default to the example the tool is run inside. The build also reports
// the author's own source files (via esbuild's metafile) for the static analyzer.

import { build } from "esbuild";
import { join, resolve } from "node:path";
import process from "node:process";

/** Peer modules the runtime owns — bundled never, resolved at load time. */
export const HOST_PROVIDED_EXTERNALS = ["graphql"];

/** The extension source of the example the tool is invoked inside (cwd-relative). */
export function defaultEntry(): string {
  return join(process.cwd(), "src", "extension.ts");
}

/** The bundle output for the example the tool is invoked inside (cwd-relative). */
export function defaultOutfile(): string {
  return join(process.cwd(), "dist", "extension.js");
}

export interface BuildResult {
  /** Absolute path to the bundled artifact. */
  outfile: string;
  /**
   * The author's own source files that went into the bundle (entry + local
   * imports), absolute paths. npm packages are excluded — these feed the static
   * analyzer, which only checks code the author wrote.
   */
  sourceFiles: string[];
}

/** Bundle `entry` into a single self-contained CJS file at `outfile`. */
export async function buildBundle(
  entry: string = defaultEntry(),
  outfile: string = defaultOutfile(),
): Promise<BuildResult> {
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "cjs",
    platform: "neutral",
    target: "node22",
    conditions: ["worker"],
    external: HOST_PROVIDED_EXTERNALS,
    metafile: true,
    logLevel: "silent",
  });
  const sourceFiles = Object.keys(result.metafile.inputs)
    .filter((input) => !input.includes("node_modules"))
    .map((input) => resolve(process.cwd(), input));
  return { outfile, sourceFiles };
}

/** `ee-ext build` — bundle the current example to its `dist/extension.js`. */
export async function buildCommand(): Promise<void> {
  const { outfile } = await buildBundle();
  process.stdout.write(`✓ bundled ${defaultEntry()} → ${outfile}\n`);
}
