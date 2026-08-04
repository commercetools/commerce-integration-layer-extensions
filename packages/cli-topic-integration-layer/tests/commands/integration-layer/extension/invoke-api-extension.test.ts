import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExtensionInvokeApiExtension from "../../../../src/commands/integration-layer/extension/invoke-api-extension.js";

// The deployed path calls the integration layer through ilClient; stub that boundary.
// (The transport it fronts is specced in the integration-layer repo.)
vi.mock("../../../../src/lib/ilClient.js", () => ({
  invokeDeployedApiExtension: vi.fn(),
}));
const { invokeDeployedApiExtension } = await import("../../../../src/lib/ilClient.js");
const invokeDeployedMock = vi.mocked(invokeDeployedApiExtension);

/**
 * Run the command and collect its `log`/`warn` output. The command extends the auth
 * base (@commercetools/cli-common binds the output stream at import), so `@oclif/test`'s
 * `captureOutput` can't intercept stdout here — spy the command's own log methods
 * instead, which is agnostic to how oclif routes the write.
 */
async function invoke(argv: string[]): Promise<{ out: string; err: string; error?: Error }> {
  const out: string[] = [];
  const err: string[] = [];
  const proto = ExtensionInvokeApiExtension.prototype as unknown as {
    log: (...a: unknown[]) => void;
    warn: (m: string) => string;
  };
  const logSpy = vi.spyOn(proto, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.map(String).join(" "));
  });
  const warnSpy = vi.spyOn(proto, "warn").mockImplementation((m: string) => {
    err.push(String(m));
    return m;
  });
  let error: Error | undefined;
  try {
    await ExtensionInvokeApiExtension.run(argv);
  } catch (e) {
    error = e as Error;
  } finally {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  }
  return { out: out.join("\n"), err: err.join("\n"), error };
}

/** Write an extension source into a temp package; return the flags addressing it. */
async function bundleFlags(source: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "il-cli-invoke-"));
  await mkdir(join(dir, "src"), { recursive: true });
  const entry = join(dir, "src", "extension.ts");
  await writeFile(entry, source, "utf8");
  return ["--entry", entry, "--out", join(dir, "dist", "extension.js")];
}

/** Write a commercetools ExtensionInput JSON file; return its path. */
async function writeInput(
  dirPrefix: string,
  input: { action: string; resource: { typeId: string; id: string; obj: unknown } },
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), dirPrefix));
  const inputPath = join(dir, "input.json");
  await writeFile(inputPath, JSON.stringify(input), "utf8");
  return inputPath;
}

function cartInput(quantity: number, sku = "BLOCKED-SKU") {
  return {
    action: "Create",
    resource: {
      typeId: "cart",
      id: "sample-cart",
      obj: {
        id: "sample-cart",
        lineItems: [{ id: "sample-line-item", quantity, variant: { sku } }],
      },
    },
  };
}

/** A handler in the shape `examples/cart-quantity-cap` ships: cap, don't block. */
const QUANTITY_CAP = `
  export const apiExtensions = [
    {
      key: "quantity-cap",
      resourceTypeId: "cart",
      actions: ["Create", "Update"],
      handler: (input, ctx) => {
        const raw = ctx.config.MAX_LINE_QUANTITY;
        if (raw === undefined) return {};
        const cap = Number(raw);
        const over = input.resource.obj.lineItems.filter((li) => li.quantity > cap);
        return over.length
          ? { actions: over.map((li) => ({ action: "changeLineItemQuantity", lineItemId: li.id, quantity: cap })) }
          : {};
      },
    },
  ];
`;

describe("integration-layer extension invoke-api-extension", () => {
  it("modifies a cart line item when quantity exceeds the configured cap", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    const inputPath = await writeInput("il-cli-invoke-cart-", cartInput(25));
    const { out } = await invoke([...flags, "--input", inputPath, "--config", "MAX_LINE_QUANTITY=10"]);

    expect(out).toContain("MODIFY");
    expect(out).toContain("changeLineItemQuantity");
  });

  it("approves when the cart quantity is under the cap", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    const inputPath = await writeInput("il-cli-invoke-cart-", cartInput(2));
    const { out } = await invoke([...flags, "--input", inputPath, "--config", "MAX_LINE_QUANTITY=10"]);

    expect(out).toContain("APPROVE");
  });
});

/** A bundle with two handlers on different resource types. */
const MIXED = `
  export const apiExtensions = [
    { key: "cart-guard", resourceTypeId: "cart", actions: ["Create", "Update"],
      handler: () => ({ errors: [{ code: "NoCart", message: "blocked" }] }) },
    { key: "order-tagger", resourceTypeId: "order", actions: ["Create"],
      handler: (input) => ({ actions: [{ action: "setKey", key: "seen-" + input.resource.id }] }) },
  ];
`;

describe("integration-layer extension invoke-api-extension — any resource type", () => {
  it("invokes a matching handler and skips handlers that do not trigger", async () => {
    const flags = await bundleFlags(MIXED);
    const inputPath = await writeInput("il-cli-invoke-order-", {
      action: "Create",
      resource: { typeId: "order", id: "o-42", obj: { id: "o-42" } },
    });
    const { out } = await invoke([...flags, "--input", inputPath]);

    expect(out).toContain("on order");
    expect(out).toContain("order-tagger: MODIFY");
    expect(out).toContain("setKey");
    expect(out).toContain("cart-guard: skipped");
  });

  it("restricts invocation to --key handlers", async () => {
    const flags = await bundleFlags(MIXED);
    const inputPath = await writeInput("il-cli-invoke-cart-", cartInput(1));
    const { out } = await invoke([...flags, "--input", inputPath, "--key", "cart-guard"]);

    expect(out).toContain("Invoking 1 handler(s)");
    expect(out).toContain("cart-guard: BLOCK");
    expect(out).not.toContain("order-tagger");
  });

  it("errors when --input is not a valid ExtensionInput", async () => {
    const flags = await bundleFlags(MIXED);
    const dir = await mkdtemp(join(tmpdir(), "il-cli-invoke-bad-"));
    const inputPath = join(dir, "bad.json");
    await writeFile(inputPath, JSON.stringify({ nope: true }), "utf8");

    const { error } = await invoke([...flags, "--input", inputPath]);
    expect(error?.message).toMatch(/ExtensionInput/);
  });

  it("errors when --input omits action", async () => {
    const flags = await bundleFlags(MIXED);
    const dir = await mkdtemp(join(tmpdir(), "il-cli-invoke-no-action-"));
    const inputPath = join(dir, "resource-only.json");
    await writeFile(
      inputPath,
      JSON.stringify({ resource: { typeId: "order", id: "o-1", obj: { id: "o-1" } } }),
      "utf8",
    );

    const { error } = await invoke([...flags, "--input", inputPath]);
    expect(error?.message).toMatch(/action/);
  });
});

describe("integration-layer extension invoke-api-extension — --all", () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it("invokes handlers merged from every extension under ./extensions/*", async () => {
    const root = await mkdtemp(join(tmpdir(), "il-cli-invoke-all-"));
    const write = async (name: string, source: string): Promise<void> => {
      await mkdir(join(root, "extensions", name, "src"), { recursive: true });
      await writeFile(join(root, "extensions", name, "src", "extension.ts"), source, "utf8");
    };
    await write(
      "guard",
      `export const apiExtensions = [
        { key: "cart-guard", resourceTypeId: "cart", actions: ["Create", "Update"],
          handler: () => ({ errors: [{ code: "NoCart", message: "blocked" }] }) },
      ];`,
    );
    await write(
      "tagger",
      `export const apiExtensions = [
        { key: "cart-tagger", resourceTypeId: "cart", actions: ["Create", "Update"],
          handler: () => ({ actions: [{ action: "setKey", key: "tagged" }] }) },
      ];`,
    );

    const inputPath = await writeInput("il-cli-invoke-all-input-", cartInput(1));
    process.chdir(root);
    const { out } = await invoke(["--all", "--out", join(root, "dist", "extension.js"), "--input", inputPath]);

    expect(out).toContain("Invoking 2 handler(s)");
    expect(out).toContain("cart-guard: BLOCK");
    expect(out).toContain("cart-tagger: MODIFY");
  });
});

describe("integration-layer extension invoke-api-extension — ctx.config from the environment", () => {
  const cwd = process.cwd();
  let envDir: string | undefined;

  afterEach(async () => {
    delete process.env.EXTENSION_CONFIG_MAX_LINE_QUANTITY;
    process.chdir(cwd);
    if (envDir) await rm(envDir, { recursive: true, force: true });
    envDir = undefined;
  });

  it("reads EXTENSION_CONFIG_* from the environment when --config is omitted", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    const inputPath = await writeInput("il-cli-invoke-env-", cartInput(25));
    process.env.EXTENSION_CONFIG_MAX_LINE_QUANTITY = "10";
    const { out } = await invoke([...flags, "--input", inputPath]);
    expect(out).toContain("MODIFY");
  });

  it("lets an explicit --config override EXTENSION_CONFIG_* from the environment", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    const inputPath = await writeInput("il-cli-invoke-env-", cartInput(25));
    process.env.EXTENSION_CONFIG_MAX_LINE_QUANTITY = "100";
    const { out } = await invoke([...flags, "--input", inputPath, "--config", "MAX_LINE_QUANTITY=10"]);
    expect(out).toContain("MODIFY");
  });

  it("auto-loads a .env from the cwd (no --config)", async () => {
    const flags = await bundleFlags(QUANTITY_CAP);
    const inputPath = await writeInput("il-cli-invoke-env-", cartInput(25));
    envDir = await mkdtemp(join(tmpdir(), "il-cli-invoke-env-"));
    await writeFile(join(envDir, ".env"), "EXTENSION_CONFIG_MAX_LINE_QUANTITY=10\n", "utf8");
    process.chdir(envDir);
    const { out } = await invoke([...flags, "--input", inputPath]);
    expect(out).toContain("MODIFY");
  });
});

describe("integration-layer extension invoke-api-extension — --deployed", () => {
  const IL_CTX = {
    baseUrl: "https://extensions.integration-layer.example.com",
    projectKey: "proj-x",
    authFetch: (async () => new Response()) as unknown as typeof fetch,
  };

  afterEach(() => {
    invokeDeployedMock.mockReset();
    vi.restoreAllMocks();
  });

  /** Stub the login-derived IL context so the deployed path doesn't need a real login. */
  function stubIlContext() {
    return vi
      .spyOn(ExtensionInvokeApiExtension.prototype as unknown as { resolveIlContext: () => Promise<typeof IL_CTX> }, "resolveIlContext")
      .mockResolvedValue(IL_CTX);
  }

  it("forwards the payload to the IL and renders an APPROVE verdict", async () => {
    const ctxSpy = stubIlContext();
    invokeDeployedMock.mockResolvedValue({ status: 200, result: {} });
    const inputPath = await writeInput("il-cli-invoke-deployed-", cartInput(1));

    const { out, err } = await invoke(["--deployed", "--input", inputPath]);

    // The live-extension warning fires, and the connector's approve verdict is shown.
    expect(err).toMatch(/LIVE deployed extension/);
    expect(out).toContain("APPROVE");
    expect(out).toContain("connector HTTP 200");
    // It called through the IL client with the resolved context + parsed payload.
    expect(invokeDeployedMock).toHaveBeenCalledWith(
      IL_CTX.baseUrl,
      IL_CTX.projectKey,
      IL_CTX.authFetch,
      expect.objectContaining({ action: "Create", resource: expect.objectContaining({ typeId: "cart" }) }),
    );
    ctxSpy.mockRestore();
  });

  it("renders a connector BLOCK (400) as a verdict, not an error", async () => {
    const ctxSpy = stubIlContext();
    invokeDeployedMock.mockResolvedValue({
      status: 400,
      result: { errors: [{ code: "InvalidInput", message: "nope" }] },
    });
    const inputPath = await writeInput("il-cli-invoke-deployed-", cartInput(1));

    const { out, error } = await invoke(["--deployed", "--input", inputPath]);

    expect(error).toBeUndefined();
    expect(out).toContain("BLOCK");
    expect(out).toContain("connector HTTP 400");
    ctxSpy.mockRestore();
  });

  it("surfaces a reach failure from the IL as an error", async () => {
    const ctxSpy = stubIlContext();
    invokeDeployedMock.mockRejectedValue(
      new Error("could not invoke the deployed extension (404): No extensions-sandbox deployment"),
    );
    const inputPath = await writeInput("il-cli-invoke-deployed-", cartInput(1));

    const { error } = await invoke(["--deployed", "--input", inputPath]);

    expect(error?.message).toMatch(/could not invoke the deployed extension/);
    ctxSpy.mockRestore();
  });

  it("rejects --deployed combined with a local-bundle flag (--all)", async () => {
    const inputPath = await writeInput("il-cli-invoke-deployed-", cartInput(1));
    const { error } = await invoke(["--deployed", "--all", "--input", inputPath]);
    expect(error?.message).toMatch(/--all/);
    expect(invokeDeployedMock).not.toHaveBeenCalled();
  });

  it("rejects --deployed combined with --key (no per-key verdict on the deployed path)", async () => {
    const inputPath = await writeInput("il-cli-invoke-deployed-", cartInput(1));
    const { error } = await invoke(["--deployed", "--key", "some-handler", "--input", inputPath]);
    expect(error?.message).toMatch(/--key/);
    expect(invokeDeployedMock).not.toHaveBeenCalled();
  });

  it("rejects --deployed combined with --config (deployed uses stored config)", async () => {
    const inputPath = await writeInput("il-cli-invoke-deployed-", cartInput(1));
    const { error } = await invoke(["--deployed", "--config", "K=V", "--input", inputPath]);
    expect(error?.message).toMatch(/--config/);
    expect(invokeDeployedMock).not.toHaveBeenCalled();
  });
});
