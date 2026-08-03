// `build --all` / `push --all` produce the ONE combined bundle a project deploys.
// This drives buildCombinedBundle over a scratch monorepo of two extensions and proves
// the artifact loads with a merged `typeDefs` (both root fields on one `Query`), merged
// executable `resolvers`, and concatenated `apiExtensions` — the single-bundle shape.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENTRY_SEGMENT,
  discoverExtensions,
  entrySegmentFor,
  buildCombinedBundle,
} from "../../src/lib/tooling/extensions.js";
import { loadBundleSource } from "../../src/lib/tooling/loadBundle.js";

const FED = `extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")`;

async function writeExtension(
  root: string,
  name: string,
  source: string,
  segment = join("src", "extension.ts"),
): Promise<void> {
  const file = join(root, "extensions", name, segment);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, source, "utf8");
}

describe("buildCombinedBundle", () => {
  it("merges every extension into one loadable bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "il-combine-test-"));
    await writeExtension(
      root,
      "hello-world",
      `export const typeDefs = \`${FED}\n  type Query { hello: String! }\`;
export const resolvers = { Query: { hello: () => "hi" } };
`,
    );
    await writeExtension(
      root,
      "goodbye-world",
      `export const typeDefs = \`${FED}\n  type Query { goodbye: String! }\`;
export const resolvers = { Query: { goodbye: () => "bye" } };
export const apiExtensions = [
  { key: "on-cart", resourceTypeId: "cart", actions: ["Update"], handler: () => ({ actions: [] }) },
];
`,
    );

    const extensions = await discoverExtensions(root, "extensions");
    expect(extensions.map((e) => e.name)).toEqual(["goodbye-world", "hello-world"]);

    const outfile = join(root, "dist", "extension.js");
    await buildCombinedBundle(extensions, outfile);

    const mod = loadBundleSource(await readFile(outfile, "utf8")) as {
      typeDefs?: string;
      resolvers?: { Query?: Record<string, () => string> };
      apiExtensions?: { key: string }[];
    };

    // One merged SDL with both root fields on the single `Query`.
    expect(mod.typeDefs).toContain("hello");
    expect(mod.typeDefs).toContain("goodbye");

    // Merged, executable resolvers from both extensions.
    expect(mod.resolvers?.Query?.hello?.()).toBe("hi");
    expect(mod.resolvers?.Query?.goodbye?.()).toBe("bye");

    // API extensions concatenated across the repo.
    expect(mod.apiExtensions?.map((a) => a.key)).toEqual(["on-cart"]);
  });

  it("fails the build when two extensions declare the same field", async () => {
    const root = await mkdtemp(join(tmpdir(), "il-combine-test-"));
    const clash = `export const typeDefs = \`${FED}\n  type Query { dup: String! }\`;
export const resolvers = { Query: { dup: () => "x" } };
`;
    await writeExtension(root, "a", clash);
    await writeExtension(root, "b", clash);

    const extensions = await discoverExtensions(root, "extensions");
    await expect(
      buildCombinedBundle(extensions, join(root, "dist", "extension.js")),
    ).rejects.toThrow(/dup/i);
  });
});

describe("entrySegmentFor", () => {
  const root = "/repo";

  it("collapses the cwd-absolute --entry default to the plain per-package segment", () => {
    expect(entrySegmentFor(root, join(root, "src", "extension.ts"))).toBe(DEFAULT_ENTRY_SEGMENT);
  });

  it("keeps a repo-relative --entry as the per-package segment", () => {
    expect(entrySegmentFor(root, join("src", "main.ts"))).toBe(join("src", "main.ts"));
  });

  it("falls back to the default when --entry points outside the repo root", () => {
    expect(entrySegmentFor(root, "/elsewhere/src/extension.ts")).toBe(DEFAULT_ENTRY_SEGMENT);
  });
});

describe("discoverExtensions with a custom entry segment", () => {
  it("finds packages by the given per-package source segment", async () => {
    const root = await mkdtemp(join(tmpdir(), "il-entry-test-"));
    const segment = join("src", "main.ts");
    await writeExtension(
      root,
      "alpha",
      `export const typeDefs = \`${FED}\n  type Query { alpha: String! }\`;
export const resolvers = { Query: { alpha: () => "a" } };
`,
      segment,
    );
    // A sibling that only has the default entry must NOT be picked up under the custom segment.
    await writeExtension(
      root,
      "beta",
      `export const typeDefs = \`${FED}\n  type Query { beta: String! }\`;
export const resolvers = { Query: { beta: () => "b" } };
`,
    );

    const found = await discoverExtensions(root, "extensions", segment);
    expect(found.map((e) => e.name)).toEqual(["alpha"]);
    expect(found[0]?.entry).toBe(join(root, "extensions", "alpha", segment));

    const outfile = join(root, "dist", "extension.js");
    await buildCombinedBundle(found, outfile);
    const mod = loadBundleSource(await readFile(outfile, "utf8")) as {
      resolvers?: { Query?: Record<string, () => string> };
    };
    expect(mod.resolvers?.Query?.alpha?.()).toBe("a");
  });
});
