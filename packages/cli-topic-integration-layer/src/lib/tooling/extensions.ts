// Monorepo helpers for the "one bundle per project" model. In production a project
// has a SINGLE extension bundle = one federation subgraph (all of a repo's extensions
// merged), which the router then composes with the integration-layer core subgraph.
// So a monorepo of `extensions/*` packages must:
//   - MERGE into one subgraph for local `serve --all` (mergeExtensionSubgraph), and
//   - BUILD into one bundle for `build/validate/push --all` (buildCombinedBundle),
// never one-subgraph-per-extension (that's not the deployed shape).

import { readdir, readFile, stat, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { buildSubgraphSchema, printSubgraphSchema } from "@apollo/subgraph";
import { mergeTypeDefs } from "@graphql-tools/merge";
import { Kind, parse, type GraphQLSchema } from "graphql";
import { buildBundle } from "./build.js";
import { loadBundleSource, type EvaluatedBundle } from "./loadBundle.js";

/** An extension package discovered under the workspace's extensions/ directory. */
export interface DiscoveredExtension {
  /** The package/directory name (used only for messages — the combined subgraph has one name). */
  name: string;
  /** The extension source entry (`<dir>/src/extension.ts`). */
  entry: string;
  /** The esbuild bundle output for a standalone build (`<dir>/dist/extension.js`). */
  outfile: string;
}

/**
 * Discover every extension package under `<root>/<dirName>` that has a
 * `src/extension.ts`. Sorted by name for stable, deterministic merge output.
 */
export async function discoverExtensions(
  root: string,
  dirName: string,
): Promise<DiscoveredExtension[]> {
  const base = join(root, dirName);
  const dirents = await readdir(base, { withFileTypes: true }).catch(() => []);
  const found: DiscoveredExtension[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const entry = join(base, dirent.name, "src", "extension.ts");
    const hasEntry = await stat(entry)
      .then((s) => s.isFile())
      .catch(() => false);
    if (!hasEntry) continue;
    found.push({
      name: dirent.name,
      entry,
      outfile: join(base, dirent.name, "dist", "extension.js"),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** One extension's contribution to the combined subgraph. */
export interface ExtensionModule {
  name: string;
  typeDefs: string;
  resolvers: object;
}

/** The single subgraph all extensions merge into. */
export interface MergedSubgraph {
  /** Executable subgraph schema (typeDefs + wired resolvers) — for serving. */
  schema: GraphQLSchema;
  /** Federation SDL of the merged subgraph — for composing with the core / publishing. */
  sdl: string;
}

/** Collect `Type.field` keys an SDL declares on object/interface types (incl. extensions). */
function declaredFields(sdl: string): { type: string; field: string }[] {
  const out: { type: string; field: string }[] = [];
  for (const def of parse(sdl).definitions) {
    if (
      def.kind === Kind.OBJECT_TYPE_DEFINITION ||
      def.kind === Kind.OBJECT_TYPE_EXTENSION ||
      def.kind === Kind.INTERFACE_TYPE_DEFINITION ||
      def.kind === Kind.INTERFACE_TYPE_EXTENSION
    ) {
      for (const f of def.fields ?? []) out.push({ type: def.name.value, field: f.name.value });
    }
  }
  return out;
}

/**
 * Merge several extension modules into ONE federation subgraph — the single bundle a
 * project deploys. Each extension's SDL is a self-contained subgraph (its own
 * `type Query`, its own `@link` header), so we can't just concatenate them
 * (`buildSubgraphSchema` would see two `type Query`). `mergeTypeDefs` folds same-named
 * types into one — so two extensions can each contribute fields to `Query` — and dedupes
 * the repeated `@link`.
 *
 * First we reject two extensions declaring the SAME field (even identically): merged into
 * one bundle their resolvers would silently shadow each other, so it's an authoring error
 * we name loudly rather than paper over. The merged SDL is printed with
 * `printSubgraphSchema`, so it round-trips as the exact federation SDL the IL validates /
 * publishes for the deployed bundle.
 */
export function mergeExtensionSubgraph(modules: ExtensionModule[]): MergedSubgraph {
  if (modules.length === 0) {
    throw new Error("no extension exports a GraphQL subgraph (typeDefs) to merge");
  }
  const resolvers: Record<string, Record<string, unknown>> = {};
  const sdls: string[] = [];
  const owner = new Map<string, string>(); // "Type.field" -> first extension that declared it
  for (const m of modules) {
    if (typeof m.typeDefs !== "string" || m.typeDefs.trim() === "") {
      throw new Error(`extension '${m.name}' must export a non-empty \`typeDefs\` string`);
    }
    if (m.resolvers === null || typeof m.resolvers !== "object") {
      throw new Error(`extension '${m.name}' with \`typeDefs\` must also export a \`resolvers\` object`);
    }
    let fields;
    try {
      fields = declaredFields(m.typeDefs);
    } catch (err) {
      throw new Error(`extension '${m.name}' has invalid \`typeDefs\`: ${(err as Error).message}`);
    }
    for (const { type, field } of fields) {
      const key = `${type}.${field}`;
      const prev = owner.get(key);
      if (prev !== undefined && prev !== m.name) {
        throw new Error(
          `extensions '${prev}' and '${m.name}' both declare \`${key}\` — a project ships one bundle, so each field must be owned by a single extension`,
        );
      }
      owner.set(key, m.name);
    }
    sdls.push(m.typeDefs);
    // Merge resolvers per type then per field — the same shape the combined bundle uses.
    for (const [type, fieldResolvers] of Object.entries(m.resolvers as Record<string, unknown>)) {
      resolvers[type] = Object.assign(resolvers[type] ?? {}, fieldResolvers as Record<string, unknown>);
    }
  }

  let schema: GraphQLSchema;
  try {
    // `mergeTypeDefs` folds the per-extension subgraphs into one document. `@apollo/subgraph`
    // types `resolvers` as its internal `GraphQLResolverMap`; cast through the param type.
    const typeDefs = mergeTypeDefs(sdls);
    schema = buildSubgraphSchema({ typeDefs, resolvers } as unknown as Parameters<
      typeof buildSubgraphSchema
    >[0]);
  } catch (err) {
    throw new Error(`extensions do not merge into a single subgraph: ${(err as Error).message}`);
  }
  return { schema, sdl: printSubgraphSchema(schema) };
}

/** Result of a combined build — the same shape {@link buildBundle} returns. */
export interface CombinedBuildResult {
  /** Absolute path to the single combined bundle. */
  outfile: string;
  /** The authors' source files that went into it (for static analysis; excludes the generated entry). */
  sourceFiles: string[];
}

/**
 * Build ONE combined bundle from every discovered extension — the artifact `push`
 * uploads. Each extension is bundled + loaded to read its `typeDefs` (merged into one
 * SDL, so a clash fails here on the author's machine) and to be re-imported by a
 * generated entry that, at load time, merges the resolvers (per type, then per field),
 * concatenates `apiExtensions`, and merges `hooks`. That entry is then bundled into the
 * final self-contained artifact — a faithful stand-in for the single deployed bundle.
 */
export async function buildCombinedBundle(
  extensions: DiscoveredExtension[],
  outfile: string,
): Promise<CombinedBuildResult> {
  if (extensions.length === 0) {
    throw new Error("no extensions to build");
  }

  // 1. Bundle + load each extension to read its exported subgraph (typeDefs/resolvers).
  const tmp = await mkdtemp(join(tmpdir(), "il-combine-"));
  const loaded: { name: string; module: EvaluatedBundle }[] = [];
  for (const ext of extensions) {
    const out = join(tmp, `${ext.name}.js`);
    await buildBundle(ext.entry, out);
    loaded.push({ name: ext.name, module: loadBundleSource(await readFile(out, "utf8")) });
  }

  // 2. Merge the subgraph-bearing extensions into one SDL (conflict detection). An
  //    extension may be API-extensions-only (no typeDefs) — those contribute no SDL.
  const withSubgraph = loaded.filter(
    (l) => typeof l.module.typeDefs === "string" && (l.module.typeDefs as string).trim() !== "",
  );
  const mergedSdl =
    withSubgraph.length > 0
      ? mergeExtensionSubgraph(
          withSubgraph.map((l) => ({
            name: l.name,
            typeDefs: l.module.typeDefs as string,
            resolvers: (l.module.resolvers as object | undefined) ?? {},
          })),
        ).sdl
      : undefined;

  // 3. Generate the combining entry: re-import each extension, merge at load time.
  const imports = extensions
    .map((e, i) => `import * as e${i} from ${JSON.stringify(e.entry)};`)
    .join("\n");
  const modulesArray = `[${extensions.map((_, i) => `e${i}`).join(", ")}]`;
  const entrySource = `${imports}

const __modules = ${modulesArray};

${mergedSdl !== undefined ? `export const typeDefs = ${JSON.stringify(mergedSdl)};` : ""}

const __mergeResolvers = (mods) => {
  const out = {};
  for (const m of mods) {
    const r = m && m.resolvers;
    if (!r || typeof r !== "object") continue;
    for (const type of Object.keys(r)) {
      out[type] = Object.assign(out[type] ?? {}, r[type]);
    }
  }
  return out;
};

export const resolvers = __mergeResolvers(__modules);
export const apiExtensions = __modules.flatMap((m) =>
  m && Array.isArray(m.apiExtensions) ? m.apiExtensions : [],
);
export const hooks = Object.assign(
  {},
  ...__modules.map((m) => (m && m.hooks && typeof m.hooks === "object" ? m.hooks : {})),
);
`;
  const entryPath = join(tmp, "combined-entry.ts");
  await writeFile(entryPath, entrySource, "utf8");

  // 4. Bundle the generated entry into the single artifact. Its imported author sources
  //    feed static analysis; the generated entry itself is trusted, so drop it.
  const { sourceFiles } = await buildBundle(entryPath, outfile);
  const generated = resolve(entryPath);
  return { outfile, sourceFiles: sourceFiles.filter((f) => resolve(f) !== generated) };
}

/** What {@link bundleForFlags} produced, plus a label for the command's log line. */
export interface BundleForFlags extends CombinedBuildResult {
  /** Human description of what was bundled (the entry, or "N extension(s) (…)"). */
  describe: string;
}

/**
 * The single build step shared by `build`/`validate`/`push`: bundle either the one
 * extension in the cwd (default) or — with `--all` — every extension under
 * `<extensionsDir>/*` merged into the one combined bundle a project deploys. Throws a
 * clean message when `--all` finds nothing to build.
 */
export async function bundleForFlags(opts: {
  all: boolean;
  extensionsDir: string;
  entry: string;
  out: string;
  cwd?: string;
}): Promise<BundleForFlags> {
  if (!opts.all) {
    const { outfile, sourceFiles } = await buildBundle(opts.entry, opts.out);
    return { outfile, sourceFiles, describe: opts.entry };
  }
  const extensions = await discoverExtensions(opts.cwd ?? process.cwd(), opts.extensionsDir);
  if (extensions.length === 0) {
    throw new Error(
      `no extensions found under ./${opts.extensionsDir}/*/src/extension.ts — run --all from the monorepo root`,
    );
  }
  const { outfile, sourceFiles } = await buildCombinedBundle(extensions, opts.out);
  return {
    outfile,
    sourceFiles,
    describe: `${extensions.length} extension(s) (${extensions.map((e) => e.name).join(", ")})`,
  };
}
