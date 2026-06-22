// Validate a built bundle before it is pushed, so a broken one fails on the author's
// machine rather than when it is loaded live. Two local checks (the push sends the
// SDL only, so these have no remote equivalent; composition is the remote check):
//   1. STATIC ANALYSIS of the source (staticAnalysis.ts) — run first, rejects the
//      patterns that won't work at runtime.
//   2. SHAPE + COHERENCE — load the bundle and confirm it exports a non-empty
//      `typeDefs` string and a `resolvers` object whose types/fields the SDL declares
//      (a resolver naming an undeclared field is a silent runtime no-op).

import { readFile } from "node:fs/promises";
import {
  GraphQLInterfaceType,
  GraphQLObjectType,
  buildASTSchema,
  parse,
  type DocumentNode,
} from "graphql";

import { loadBundleSource } from "./loadBundle.js";
import { analyzeSources } from "./staticAnalysis.js";

/** Thrown when a bundle fails validation; `message` is safe to surface to the author. */
export class BundleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleValidationError";
  }
}

export type ValidationResult = {
  /** The bundle's exported SDL. */
  typeDefs: string;
  /** The resolver root keys that matched a type in the schema (e.g. `Query`). */
  resolverTypes: string[];
};

type ExtensionModule = { typeDefs?: unknown; resolvers?: unknown };

/**
 * Validate the bundle at `bundlePath`, having analysed the author's `sourceFiles`
 * (the entry + its local imports, as reported by {@link buildBundle}). Resolves with
 * the parsed metadata, or rejects with a {@link BundleValidationError} carrying a
 * precise reason. Composition is the remote check's job (see the file header).
 */
export async function validateBundle(
  bundlePath: string,
  sourceFiles: string[],
): Promise<ValidationResult> {
  // 1. Static analysis of the author's source — runtime-incompatible patterns.
  const issues = await analyzeSources(sourceFiles);
  if (issues.length > 0) {
    const lines = issues.map((i) => `  - ${i.file}:${i.line} — ${i.message}`).join("\n");
    throw new BundleValidationError(
      `extension source uses features the runtime does not support:\n${lines}`,
    );
  }

  // 2. Load the built bundle and check its shape + resolver/SDL coherence.
  let mod: ExtensionModule;
  try {
    mod = loadBundleSource(await readFile(bundlePath, "utf8")) as ExtensionModule;
  } catch (err) {
    throw new BundleValidationError(`bundle is not a loadable module: ${(err as Error).message}`);
  }

  const { typeDefs, resolvers } = mod;
  if (typeof typeDefs !== "string" || typeDefs.trim() === "") {
    throw new BundleValidationError("bundle must export a non-empty `typeDefs` string");
  }
  if (resolvers === null || typeof resolvers !== "object") {
    throw new BundleValidationError("bundle must export a `resolvers` object");
  }

  let doc: DocumentNode;
  try {
    doc = parse(typeDefs);
  } catch (err) {
    throw new BundleValidationError(
      `\`typeDefs\` is not valid GraphQL SDL: ${(err as Error).message}`,
    );
  }

  // `assumeValidSDL` skips full re-validation (federation directives aren't defined
  // here; the remote compose proves the SDL sound) but still rejects an SDL that
  // references a type it never declares.
  let schema;
  try {
    schema = buildASTSchema(doc, { assumeValidSDL: true });
  } catch (err) {
    throw new BundleValidationError(
      `\`typeDefs\` does not build into a valid schema: ${(err as Error).message}`,
    );
  }

  // Coherence: every resolver type/field must exist in the schema. A typo here
  // would otherwise be a silent no-op the runtime serves without complaint.
  const resolverMap = resolvers as Record<string, unknown>;
  const resolverTypes: string[] = [];
  for (const typeName of Object.keys(resolverMap)) {
    if (typeName.startsWith("__")) continue; // e.g. __resolveType — not a schema type
    const type = schema.getType(typeName);
    if (!type) {
      throw new BundleValidationError(
        `\`resolvers\` references type \`${typeName}\`, which \`typeDefs\` does not define`,
      );
    }
    resolverTypes.push(typeName);

    const fieldResolvers = resolverMap[typeName];
    if (
      fieldResolvers &&
      typeof fieldResolvers === "object" &&
      (type instanceof GraphQLObjectType || type instanceof GraphQLInterfaceType)
    ) {
      const schemaFields = type.getFields();
      for (const fieldName of Object.keys(fieldResolvers)) {
        if (fieldName.startsWith("__")) continue; // e.g. __resolveReference
        if (!(fieldName in schemaFields)) {
          throw new BundleValidationError(
            `resolver \`${typeName}.${fieldName}\` has no matching field in \`typeDefs\``,
          );
        }
      }
    }
  }

  return { typeDefs, resolverTypes };
}
