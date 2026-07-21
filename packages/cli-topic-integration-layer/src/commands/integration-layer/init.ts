import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Args, Command, Flags } from "@oclif/core";

// The `basic` template is vendored inline (no network fetch) — a minimal, buildable
// extension: a GraphQL subgraph field plus a commented API-Extension example. Keep it
// dependency-light so `extension build`/`validate` work on it out of the box.
const TEMPLATE_FILES: Record<string, string> = {
  "src/extension.ts": `// A minimal integration-layer extension.
//
// Export a GraphQL subgraph (\`typeDefs\` + \`resolvers\`) to add fields to the graph,
// and/or \`apiExtensions\` to run synchronous commercetools cart/order callbacks.
// Build it with:  commercetools integration-layer extension build
// Serve it with:  commercetools integration-layer extension serve

export const typeDefs = /* GraphQL */ \`
  type Query {
    extensionInfo: String
  }
\`;

export const resolvers = {
  Query: {
    extensionInfo: () => "hello from the integration-layer extension",
  },
};

// // Example API Extension (uncomment to block a cart line item by SKU):
// export const apiExtensions = [
//   {
//     key: "block-sku",
//     resourceTypeId: "cart",
//     actions: ["Create", "Update"],
//     handler: (input, ctx) => {
//       const blocked = ctx.config.BLOCKED_SKU ?? "BLOCKED-SKU";
//       const items = input.resource.obj?.lineItems ?? [];
//       if (items.some((li) => li.variant?.sku === blocked)) {
//         return { errors: [{ code: "SkuBlocked", message: \\\`\\\${blocked} is not purchasable\\\` }] };
//       }
//       return {};
//     },
//   },
// ];
`,
  "package.json": `{
  "name": "integration-layer-extension",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "commercetools integration-layer extension build",
    "serve": "commercetools integration-layer extension serve",
    "push": "commercetools integration-layer extension push"
  },
  "devDependencies": {
    "@commercetools/platform-sdk": "8.25.0",
    "graphql": "^16.9.0",
    "typescript": "^5.7.2"
  }
}
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
`,
  ".env.example": `# The authenticated commands (validate/push/status/delete, schema, config) reuse the
# token from \`commercetools auth login\` (as a manage_project client) — no credentials
# go here. Optionally override the integration-layer edge URL. Copy to .env.
INTEGRATION_LAYER_URL=
`,
  ".gitignore": `node_modules/
dist/
.env
`,
  "README.md": `# integration-layer extension

Scaffolded by \`commercetools integration-layer init\`.

- \`commercetools integration-layer extension build\` — bundle \`src/extension.ts\`
- \`commercetools integration-layer extension serve\` — local dev server
- \`commercetools integration-layer extension push\` — validate + upload

Run \`commercetools auth login\` first — the authenticated commands (push/validate/
status/delete, schema, config) reuse that token. Optionally copy \`.env.example\` to
\`.env\` to override the integration-layer edge URL.
`,
};

export default class Init extends Command {
  static override description = "Scaffold an integration-layer extension project from a template";

  static override examples = [
    "<%= config.bin %> integration-layer init my-extension",
    "<%= config.bin %> integration-layer init my-extension --template basic",
  ];

  static override args = {
    directory: Args.string({ description: "directory to scaffold into", required: true }),
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

    for (const [relPath, contents] of Object.entries(TEMPLATE_FILES)) {
      const target = join(dir, relPath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, contents, "utf8");
    }

    this.log(`✓ scaffolded a '${flags.template}' extension in ${dir}`);
    this.log("Next steps:");
    this.log(`  cd ${dir}`);
    this.log("  npm install");
    this.log("  commercetools integration-layer extension serve");
  }
}
