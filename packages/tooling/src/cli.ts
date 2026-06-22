// The `ee-ext` CLI — the shared build → validate → push flow, run from inside
// whichever example you're working in (each command resolves the template from the
// cwd; validate/push also load the shared `.env`). Invoked via bin/ee-ext.mjs.

import process from "node:process";
import { loadProjectEnv } from "./env.js";
import { buildCommand } from "./build.js";
import { validateCommand } from "./validate.js";
import { pushCommand } from "./push.js";
import { serveCommand } from "./serve.js";

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case "build":
      await buildCommand();
      break;
    case "validate":
      loadProjectEnv();
      await validateCommand();
      break;
    case "push":
      loadProjectEnv();
      await pushCommand();
      break;
    case "serve":
      await serveCommand();
      break;
    default:
      process.stderr.write(
        `ee-ext: unknown command '${command ?? ""}'. Use: build | validate | push | serve\n`,
      );
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`ee-ext ${command ?? ""} failed: ${(err as Error).message}\n`);
  process.exit(1);
});
