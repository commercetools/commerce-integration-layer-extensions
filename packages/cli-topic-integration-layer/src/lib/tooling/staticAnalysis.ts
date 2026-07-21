// Best-effort static analysis of an extension's source, run by `validate`/`push`.
//
// Kept in sync with commercetools/integration-layer-extension-examples
// (packages/tooling/src/staticAnalysis.ts) — that repo is the canonical copy, and it
// in turn mirrors the connector's `webPlatformEndowments` (octolog-extensions-sandbox
// service/src/bundle/sandbox/compartment.ts), the real source of truth for what the
// sandbox endows. When the connector's endowment list changes, update ILEE first,
// then port the change here. The resolver environment provides a restricted set of
// capabilities, not a full Node runtime, so this flags patterns that won't work there
// before the bundle is uploaded. It parses the author's own source files to a
// TypeScript AST (so a mention in a comment or string is never a false positive) and
// is a lint, not an enforcement boundary — it catches honest mistakes, not deliberate
// obfuscation. It rejects:
//   - a well-known global the sandbox does NOT endow (`process`, `Buffer`,
//     `setInterval`, `SharedArrayBuffer`, `WebAssembly`, DOM globals, …) — so an
//     author who reaches for one is warned here instead of crashing at runtime;
//   - importing a Node built-in (`fs`, `crypto`, `node:*`, …) — use `fetch` or an npm package;
//   - `eval` / `new Function`.

import { readFile } from "node:fs/promises";
import ts from "typescript";

/** Node core modules an extension may not import; `node:`-prefixed ids are also rejected. */
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "dns", "domain", "events", "fs", "http",
  "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl", "stream",
  "string_decoder", "sys", "timers", "tls", "trace_events", "tty", "url",
  "util", "v8", "vm", "worker_threads", "zlib",
]);

// The web-platform globals the sandbox endows (its "Tier-1 data surface"), on top
// of the ECMAScript intrinsics SES lockdown leaves in place (JSON, Object, Array,
// Map, Set, Promise, RegExp, typed arrays, …, always available). This mirrors the
// connector's `webPlatformEndowments` (bundle/sandbox/compartment.ts) and is the
// SOURCE OF TRUTH `UNAVAILABLE_GLOBALS` is the curated complement of — keep the two
// in sync when the connector's endowment list changes. Referenced by the check so
// a global that is BOTH endowed and (mistakenly) listed as unavailable never fires.
const ENDOWED_GLOBALS = new Set([
  "fetch",
  "setTimeout", "clearTimeout",
  "Date", "Math",
  "URL", "URLSearchParams",
  "TextEncoder", "TextDecoder", "btoa", "atob",
  "Headers", "Request", "Response", "FormData",
  "structuredClone", "Intl",
  "AbortController", "AbortSignal",
  "console", // tamed, forwarded to the host logger
]);

// Well-known globals the sandbox deliberately does NOT provide, each with a hint at
// the endowed alternative. Using one throws at runtime, so flag it at validate time.
// NOT exhaustive (it can't enumerate every absent name) and NOT a security boundary
// — a curated, high-signal set: Node-only globals, and the capability / DoS /
// side-channel globals the compartment withholds on purpose (see compartment.ts).
const UNAVAILABLE_GLOBALS = new Map<string, string>([
  // Node-only — read config from `ctx.config`, or use the web-standard equivalent.
  ["process", "read configuration from `ctx.config` instead"],
  ["Buffer", "use `TextEncoder`/`Uint8Array`, or `btoa`/`atob` for base64"],
  ["global", "use `globalThis`"],
  ["setInterval", "the sandbox endows `setTimeout`/`clearTimeout` only — loop with `setTimeout`"],
  ["clearInterval", "the sandbox endows `setTimeout`/`clearTimeout` only"],
  ["setImmediate", "use `setTimeout(fn, 0)`"],
  // Deliberately withheld (capability / DoS / side-channel) — see compartment.ts.
  ["SharedArrayBuffer", "withheld — shared memory is a cross-sandbox channel"],
  ["Atomics", "withheld — pairs with SharedArrayBuffer (channel + synchronous blocking)"],
  ["WebAssembly", "withheld — a second execution engine is not exposed to extensions"],
  ["MessageChannel", "withheld — communication primitive"],
  ["MessagePort", "withheld — communication primitive"],
  ["BroadcastChannel", "withheld — communication primitive"],
  ["WeakRef", "withheld — GC observability is a side channel"],
  ["FinalizationRegistry", "withheld — GC observability is a side channel"],
  ["performance", "withheld — high-resolution timing is a side channel; use `Date.now()`"],
  ["CompressionStream", "withheld — decompression is an unbounded DoS vector"],
  ["DecompressionStream", "withheld — decompression is an unbounded DoS vector"],
  // Browser/DOM globals that simply do not exist server-side.
  ["window", "not available (no DOM); use `globalThis`"],
  ["document", "not available (no DOM)"],
  ["localStorage", "not available; use `ctx.config` for configuration"],
  ["sessionStorage", "not available; use `ctx.config` for configuration"],
  ["XMLHttpRequest", "not available; use the global `fetch`"],
  ["WebSocket", "not available; only outbound `fetch` egress is provided"],
]);

export interface AnalysisIssue {
  file: string;
  line: number;
  message: string;
}

/** Is `spec` a Node built-in module (or a `node:`-prefixed import)? */
function isBuiltinSpecifier(spec: string): boolean {
  if (spec.startsWith("node:")) return true;
  return NODE_BUILTINS.has(spec);
}

/** Analyse one already-parsed source file, appending any issues found. */
function analyzeSourceFile(sf: ts.SourceFile, issues: AnalysisIssue[]): void {
  const report = (node: ts.Node, message: string): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    issues.push({ file: sf.fileName, line: line + 1, message });
  };

  const checkSpecifier = (spec: string, node: ts.Node): void => {
    if (isBuiltinSpecifier(spec)) {
      report(
        node,
        `imports the Node built-in "${spec}", which the runtime does not provide — ` +
          "use the global `fetch` for HTTP, or bundle an npm package",
      );
    }
  };

  const visit = (node: ts.Node): void => {
    // import ... from "x" / export ... from "x"
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkSpecifier(node.moduleSpecifier.text, node.moduleSpecifier);
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const firstArg = node.arguments[0];
      // require("x") / import("x")
      if (
        (callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && callee.text === "require")) &&
        firstArg &&
        ts.isStringLiteral(firstArg)
      ) {
        checkSpecifier(firstArg.text, firstArg);
      }
      // eval(...)
      if (ts.isIdentifier(callee) && callee.text === "eval") {
        report(node, "uses `eval`, which the runtime does not allow");
      }
    }

    // new Function(...)
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function") {
      report(node, "uses `new Function`, which the runtime does not allow");
    }

    // Reference to a global the sandbox does not endow (e.g. `process.env`,
    // `new SharedArrayBuffer(…)`). Skip when the identifier is the property side of
    // an access (`foo.process`), a declaration name, or otherwise not a value read —
    // this is a syntactic lint, so keep it to high-signal free-identifier reads.
    if (ts.isIdentifier(node) && UNAVAILABLE_GLOBALS.has(node.text) && !ENDOWED_GLOBALS.has(node.text)) {
      const parent = node.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isQualifiedName(parent) && parent.right === node);
      // A local binding of the same name (import/param/var/function/property) is the
      // author's own — not the ambient global — so don't flag it.
      const isLocalBinding =
        (ts.isParameter(parent) ||
          ts.isVariableDeclaration(parent) ||
          ts.isFunctionDeclaration(parent) ||
          ts.isBindingElement(parent) ||
          ts.isPropertyAssignment(parent) ||
          ts.isImportSpecifier(parent) ||
          ts.isImportClause(parent)) &&
        (parent as { name?: ts.Node }).name === node;
      if (!isPropertyName && !isLocalBinding) {
        const hint = UNAVAILABLE_GLOBALS.get(node.text) ?? "";
        report(
          node,
          `uses the global \`${node.text}\`, which the sandbox does not provide` +
            (hint ? ` — ${hint}` : ""),
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
}

/**
 * Analyse the given source files (the author's entry + its local imports) and
 * return every runtime-incompatibility issue found. An empty array means the source
 * is clean of the patterns this checks.
 */
export async function analyzeSources(files: string[]): Promise<AnalysisIssue[]> {
  const issues: AnalysisIssue[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, /* setParentNodes */ true);
    analyzeSourceFile(sf, issues);
  }
  return issues;
}
