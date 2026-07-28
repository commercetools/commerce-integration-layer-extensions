// `build --all` / `push --all` produce the ONE combined bundle a project deploys.
// This drives buildCombinedBundle over a scratch monorepo of two extensions and proves
// the artifact loads with a merged `typeDefs` (both root fields on one `Query`), merged
// executable `resolvers`, and concatenated `apiExtensions` — the single-bundle shape.

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverExtensions, buildCombinedBundle } from "../../src/lib/tooling/extensions.js";
import { loadBundleSource } from "../../src/lib/tooling/loadBundle.js";

const FED = `extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")`;

async function writeExtension(root: string, name: string, source: string): Promise<void> {
  const dir = join(root, "extensions", name, "src");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "extension.ts"), source, "utf8");
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
