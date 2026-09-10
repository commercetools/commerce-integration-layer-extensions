import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadBundleSource } from "../../src/lib/tooling/loadBundle.js";
import { composeWithIntegrationLayer } from "../../src/lib/tooling/compose.js";
import { analyzeSources } from "../../src/lib/tooling/staticAnalysis.js";

describe("loadBundleSource", () => {
  it("evaluates a CJS bundle and returns its exports", () => {
    const mod = loadBundleSource(
      `module.exports.typeDefs = "type Query { ping: String }";
       module.exports.resolvers = { Query: { ping: () => "pong" } };`,
    );
    expect(mod.typeDefs).toContain("ping");
    expect(typeof (mod.resolvers as { Query: { ping: () => string } }).Query.ping).toBe("function");
  });

  it("refuses to require a Node builtin that is not host-provided", () => {
    expect(() => loadBundleSource(`require("node:fs");`)).toThrow(/may not require/);
    expect(() => loadBundleSource(`require("net");`)).toThrow(/may not require/);
  });

  it("resolves http/https to the gated shim (both bare and node:-prefixed)", () => {
    for (const id of ["http", "https", "node:http", "node:https"]) {
      const mod = loadBundleSource(
        `const m = require("${id}");
         module.exports.typeDefs = "type Query { a: String }";
         module.exports.resolvers = {};
         module.exports.probe = { hasRequest: typeof m.request === "function", hasGet: typeof m.get === "function" };`,
      ) as { probe: { hasRequest: boolean; hasGet: boolean } };
      expect(mod.probe.hasRequest).toBe(true);
      expect(mod.probe.hasGet).toBe(true);
    }
  });

  it("exposes an inert Agent whose methods are no-ops (never throw)", () => {
    const mod = loadBundleSource(
      `const https = require("https");
       const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
       module.exports.typeDefs = "type Query { a: String }";
       module.exports.resolvers = {};
       module.exports.probe = {
         destroy: typeof agent.destroy,
         name: agent.getName(),
         maxSockets: agent.maxSockets,
         globalHasDestroy: typeof https.globalAgent.destroy,
       };`,
    ) as { probe: { destroy: string; name: string; maxSockets: number; globalHasDestroy: string } };
    expect(mod.probe.destroy).toBe("function");
    expect(mod.probe.name).toBe("gated-fetch");
    expect(mod.probe.maxSockets).toBe(Infinity);
    expect(mod.probe.globalHasDestroy).toBe("function");
  });

  it("routes a shim request through globalThis.fetch and emits a Node-style response", async () => {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      calls.push(String(input));
      return new Response("cat fact body", { status: 200, headers: { "x-test": "1" } });
    }) as typeof fetch;
    try {
      const mod = loadBundleSource(
        `const https = require("https");
         module.exports.typeDefs = "type Query { a: String }";
         module.exports.resolvers = {};
         module.exports.fetchOnce = (url) => new Promise((resolve, reject) => {
           const req = https.get(url, (res) => {
             let body = "";
             res.setEncoding("utf8");
             res.on("data", (c) => { body += c; });
             res.on("end", () => resolve({ status: res.statusCode, body, header: res.headers["x-test"] }));
           });
           req.on("error", reject);
         });`,
      ) as { fetchOnce: (url: string) => Promise<{ status: number; body: string; header?: string }> };
      const result = await mod.fetchOnce("https://catfact.ninja/fact");
      expect(calls).toEqual(["https://catfact.ninja/fact"]);
      expect(result.status).toBe(200);
      expect(result.body).toBe("cat fact body");
      expect(result.header).toBe("1");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("composeWithIntegrationLayer", () => {
  it("returns errors (never throws) for invalid SDL", () => {
    const result = composeWithIntegrationLayer("type Query {", "type Query { a: String }", {
      integrationLayerUrl: "http://il/graphql",
      extensionUrl: "http://ext/graphql",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toMatch(/not valid GraphQL/);
  });
});

describe("static analysis of non-endowed globals", () => {
  // analyzeSources reads files, so write throwaway sources to a temp dir.
  let tmpDir: string;
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ilc-static-analysis-"));
  });
  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const write = async (name: string, src: string): Promise<string> => {
    const p = join(tmpDir, name);
    await writeFile(p, src, "utf8");
    return p;
  };

  it("flags a global the sandbox deliberately withholds", async () => {
    const p = await write("withheld.ts", `export const x = new SharedArrayBuffer(8);\n`);
    const issues = await analyzeSources([p]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/SharedArrayBuffer/);
    expect(issues[0].message).toMatch(/does not provide/);
  });

  it("flags the ambient global `process`", async () => {
    const p = await write("ambient.ts", `export const secret = process.env.SOME_SECRET;\n`);
    const issues = await analyzeSources([p]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/process/);
  });

  it("does NOT flag an endowed global", async () => {
    const p = await write("endowed.ts", `export const q = new URLSearchParams("a=1").toString();\n`);
    expect(await analyzeSources([p])).toEqual([]);
  });

  it("does NOT flag importing http/https (host-provided as a gated shim)", async () => {
    const p = await write(
      "http-imports.ts",
      `import https from "https";\nimport http from "node:http";\nexport const ok = typeof https.get + typeof http.request;\n`,
    );
    expect(await analyzeSources([p])).toEqual([]);
  });

  it("still flags importing a non-provided Node builtin", async () => {
    const p = await write("net-import.ts", `import { connect } from "node:net";\nexport { connect };\n`);
    const issues = await analyzeSources([p]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/node:net/);
  });

  it("does NOT flag a withheld name at its declaration site (only free reads are a lint)", async () => {
    // A syntactic lint has no scope resolution — a *use* of a local shadowing a
    // withheld name would still be flagged (accepted, like the `process` check) —
    // but the declaration name itself is not the ambient global, so it isn't.
    const p = await write("decl.ts", `export const performance = 1;\n`);
    expect(await analyzeSources([p])).toEqual([]);
  });
});
