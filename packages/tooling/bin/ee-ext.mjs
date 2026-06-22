#!/usr/bin/env node
// Package bin for `ee-ext`. The tooling ships as TypeScript with no build step, so
// this thin .mjs shim registers tsx for the import subtree and loads the TS CLI.
// Each example depends on @example-extensions/tooling, so pnpm links this onto the
// example's PATH and `pnpm build|validate|push` (→ `ee-ext <cmd>`) just works.
import { tsImport } from "tsx/esm/api";

await tsImport("../src/cli.ts", import.meta.url);
