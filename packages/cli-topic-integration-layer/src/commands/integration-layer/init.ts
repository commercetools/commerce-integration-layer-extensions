import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Args, Command, Flags } from "@oclif/core";

// `init` scaffolds a MONOREPO you own and grow — a pnpm workspace whose members are
// individual extensions (`extensions/*`), seeded with one buildable hello-world
// extension that extends `Query`. The build/validate/push flow itself lives in this
// published CLI plugin, not in the scaffold, so an extension package stays tiny (just
// `src/extension.ts` + a thin package.json/tsconfig). Everything is vendored inline —
// no network fetch — and kept dependency-light so the extension commands work on it
// out of the box. The `basic` template is the only one today.

/** Derive a valid npm package name from the scaffold directory (fallback: a generic one). */
function projectNameFor(dir: string): string {
  const sanitized = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "integration-layer-extensions";
}

/** The monorepo file set, parameterized by the root package name. */
function templateFiles(projectName: string): Record<string, string> {
  return {
    "package.json": `{
  "name": ${JSON.stringify(projectName)},
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.17.0",
  "engines": {
    "node": "22.x || 24.x"
  },
  "scripts": {
    "build": "commercetools integration-layer extension build --all",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint .",
    "dev": "commercetools integration-layer extension serve --all",
    "validate": "commercetools integration-layer extension validate --all",
    "push": "commercetools integration-layer extension push --all"
  },
  "devDependencies": {
    "eslint": "^10.8.0",
    "typescript": "~6.0.3",
    "typescript-eslint": "^8.65.0"
  }
}
`,
    "pnpm-workspace.yaml": `packages:
  # Each extension is a workspace member (edit its src/extension.ts). A project deploys
  # ONE bundle, so the root \`pnpm build\` / \`validate\` / \`push\` scripts MERGE every
  # extension here into that single combined bundle — never one per package.
  - 'extensions/*'

# Refuse dependency versions published less than 24h ago. Minutes; 1440 = 24h.
minimumReleaseAge: 1440
`,
    "tsconfig.base.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
`,
    "eslint.config.js": `import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    // Allow \`_\`-prefixed unused args (resolver signatures often ignore arguments).
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
);
`,
    ".gitignore": `node_modules/
dist/
.env
`,
    ".env.example": `# The authenticated commands (validate/push/status/delete, schema, config) reuse the
# token from \`commercetools auth login\` (as a manage_project client) — no credentials
# go here. Optionally override the integration-layer edge URL. Copy to .env.
INTEGRATION_LAYER_URL=
`,
    "README.md": `# ${projectName}

A monorepo of commercetools integration-layer extensions, scaffolded by
\`commercetools integration-layer init\`. Each extension is a workspace member under
\`extensions/\`; the starter one (\`extensions/hello-world\`) adds a \`hello\` field to
\`Query\`.

A project deploys a **single bundle** — one federation subgraph the router composes
with the integration layer. So this repo's extensions are **merged into that one
bundle**: the root \`build\` / \`validate\` / \`push\` scripts combine everything under
\`extensions/\` and push it as one artifact (not one per package), and \`dev\` serves that
same merged subgraph locally. Split your code into as many \`extensions/*\` packages as
makes sense to author — they always ship as one.

## Set up the CLI (once)

The \`build\`/\`serve\`/\`validate\`/\`push\` scripts run through the **commercetools CLI**'s
\`integration-layer\` topic, added by the published
\`@commercetools/cli-topic-integration-layer\` plugin. Install the CLI globally with
pnpm, add the plugin, then log in:

\`\`\`sh
# Install the commercetools CLI globally with pnpm, then add the integration-layer
# topic. The plugin is on the public npm registry, so no auth or scope mapping is
# needed. (Install from @dev for now — the \`plugins\` command is only in the CLI's dev
# prerelease; drop @dev once it ships to @latest.)
pnpm add -g @commercetools/cli@dev
commercetools plugins install @commercetools/cli-topic-integration-layer

# Log in once — mints the manage_project token the authenticated commands reuse
# (validate/push/status/delete, schema, config) and sets your target project.
commercetools auth login --project-key <your-project-key>
\`\`\`

## Getting started

Everything runs through pnpm — the scripts below wrap the \`commercetools
integration-layer extension …\` commands.

\`\`\`sh
pnpm install

# From the repo root — these operate on the ONE combined bundle:
pnpm dev        # merge every extension into one subgraph and serve it behind a local
                # federated gateway (+ the integration layer) at
                # http://localhost:4000/graphql — the production topology in miniature.
                # Needs \`commercetools auth login\` (composes against your live schema).
pnpm validate   # compose the combined bundle against the live schema (no upload)
pnpm push       # validate + upload the combined bundle (replaces the project's one)

# …or focus on a single extension in isolation (standalone subgraph, no login needed):
pnpm --filter @extensions/hello-world dev
\`\`\`

With \`pnpm dev\` running, open http://localhost:4000/graphql for a GraphiQL over the
merged schema; the raw combined extensions subgraph is at \`/_extension\`, and the
browsable merged (extensions + integration layer) schema at \`/composed\`.

Optionally copy \`.env.example\` to \`.env\` to override the integration-layer edge URL.

## Adding another extension

Copy \`extensions/hello-world\` to \`extensions/<your-extension>\`, rename it in its
\`package.json\`, and edit its \`src/extension.ts\`. The root scripts discover every folder
under \`extensions/\` automatically and merge it into the single bundle — so \`pnpm dev\`,
\`validate\`, and \`push\` all just pick it up, with no port wrangling. (Two extensions
can each add fields to \`Query\`; they only clash if they declare the *same* field.)
`,
    "extensions/hello-world/package.json": `{
  "name": "@extensions/hello-world",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "commercetools integration-layer extension build",
    "dev": "commercetools integration-layer extension serve",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.20.1",
    "typescript": "~6.0.3"
  }
}
`,
    "extensions/hello-world/tsconfig.json": `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
`,
    "extensions/hello-world/src/extension.ts": `/**
 * A hello-world integration-layer extension — the PURELY ADDITIVE pattern: it adds a
 * brand-new root field (\`Query.hello\`) and shares nothing with the integration layer,
 * so the two \`Query\` types merge with no change to it and composition is trivial.
 *
 * An extension exports \`typeDefs\` (a federation-v2 SDL string) + \`resolvers\` and runs
 * in a restricted runtime. Edit this file, then from the repo ROOT run \`pnpm validate\` /
 * \`pnpm push\` — every extension is merged into the one bundle the project deploys (the
 * target project comes from your \`commercetools auth login\`). Iterate on just this one
 * with \`pnpm --filter @extensions/hello-world dev\`.
 */

export const typeDefs = \`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3")

  type Query {
    "A friendly greeting contributed by this extension."
    hello(name: String): String!
  }
\`;

/**
 * The per-call capability context the restricted runtime hands each resolver.
 * \`now()\` is the current epoch millis (a convenience — \`Date.now()\` works too);
 * \`config\` is this extension's merchant-supplied \`{ key: value }\` map, with secret
 * values decrypted host-side (e.g. \`ctx.config.API_KEY\`). Set values with
 * \`commercetools integration-layer config set <KEY> <VALUE>\`.
 */
interface ExtensionContext {
  now(): number;
  config: Readonly<Record<string, string>>;
}

export const resolvers = {
  Query: {
    // A resolver receives (parent, args, context): \`_parent\` is the object the field
    // hangs off (nothing here — this is a root field), \`args\` are the field arguments
    // from the query, and \`ctx\` exposes the restricted runtime's host capabilities.
    hello: (_parent: unknown, { name }: { name?: string }, ctx: ExtensionContext) => {
      const greeting = ctx.config.GREETING ?? "Hello";
      return \`\${greeting}, \${name ?? "world"}, from your integration-layer extension!\`;
    },
  },
};
`,
  };
}

export default class Init extends Command {
  static override description =
    "Scaffold an integration-layer extensions monorepo (a pnpm workspace with one hello-world extension)";

  static override examples = [
    "<%= config.bin %> integration-layer init my-extensions",
    "<%= config.bin %> integration-layer init my-extensions --template basic",
  ];

  static override args = {
    directory: Args.string({ description: "directory to scaffold the monorepo into", required: true }),
  };

  static override flags = {
    template: Flags.string({
      description: "the template to use",
      options: ["basic"],
      default: "basic",
    }),
    force: Flags.boolean({
      char: "f",
      description: "scaffold into a non-empty directory",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init);
    const dir = args.directory;

    const existing = await readdir(dir).catch(() => [] as string[]);
    if (existing.length > 0 && !flags.force) {
      this.error(`Directory '${dir}' is not empty. Pass --force to scaffold into it anyway.`);
    }

    const files = templateFiles(projectNameFor(dir));
    for (const [relPath, contents] of Object.entries(files)) {
      const target = join(dir, relPath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, contents, "utf8");
    }

    this.log(`✓ scaffolded a '${flags.template}' extensions monorepo in ${dir}`);
    this.log("Next steps:");
    this.log(`  cd ${dir}`);
    this.log("  pnpm install");
    this.log("  pnpm dev   # run the hello-world extension locally");
  }
}
