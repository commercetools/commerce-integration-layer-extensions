// Best-effort static analysis of an extension's source, run by `validate`/`push`.
// The resolver environment provides a restricted set of capabilities, not a full Node
// runtime, so this flags patterns that won't work there before the bundle is uploaded.
// It parses the author's own source files to a TypeScript AST (so a mention in a
// comment or string is never a false positive) and is a lint, not an enforcement
// boundary — it catches honest mistakes, not deliberate obfuscation. It rejects:
//   - the ambient global `process` (configuration comes through `ctx.config`);
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

/** Ambient globals the runtime does not provide (using them throws at runtime). */
const DENIED_GLOBALS = new Set(["process"]);

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

    // Reference to a denied ambient global (e.g. `process.env`). Skip the case
    // where the identifier is the property side of an access (`foo.process`).
    if (ts.isIdentifier(node) && DENIED_GLOBALS.has(node.text)) {
      const parent = node.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isQualifiedName(parent) && parent.right === node);
      if (!isPropertyName) {
        report(
          node,
          `uses the ambient global \`${node.text}\`, which the runtime does not provide — ` +
            "read configuration from `ctx.config` instead",
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
