// Load the shared, repo-root project config (`.env`). The templates carry no project
// config; the project a template is pushed to comes from this one shared file
// (INTEGRATION_LAYER_URL + CTP_* — see `.env.example`).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

/**
 * Walk up from the cwd (the example the tool runs inside) to the repo root — the
 * directory holding `pnpm-workspace.yaml` — and load its `.env` if present.
 * Already-set environment variables win (so a `CTP_PROJECT_KEY=… ee-ext push`
 * override is honoured); a missing file is fine (`required()` reports what's absent).
 */
export function loadProjectEnv(): void {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      const envPath = join(dir, ".env");
      if (existsSync(envPath)) process.loadEnvFile(envPath);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return; // reached the filesystem root, no workspace found
    dir = parent;
  }
}
