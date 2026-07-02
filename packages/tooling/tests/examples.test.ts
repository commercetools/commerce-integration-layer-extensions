// Proves each shipped example template (examples/*) builds, validates locally, and
// its resolvers behave — exactly the local half of the `ee-ext validate`/`push`
// gate, run against the real template sources (no fixtures). The remote
// compose/breaking-change half is covered on the integration-layer side.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBundle, type BuildResult } from "../src/build.js";
import { loadBundleSource } from "../src/loadBundle.js";
import { validateBundle } from "../src/validateBundle.js";

const here = dirname(fileURLToPath(import.meta.url));
const toolingRoot = join(here, "..");
// packages/tooling/tests → packages/tooling → packages → domain root.
const domainRoot = join(here, "..", "..", "..");
const exampleSrc = (name: string) => join(domainRoot, "examples", name, "src", "extension.ts");

let tmpDir: string;
beforeAll(async () => {
  tmpDir = await mkdtemp(join(toolingRoot, ".tmp-ee-test-"));
});
afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Build an example's `src/extension.ts` to a unique `.cjs` file; returns the build result. */
async function buildExample(name: string): Promise<BuildResult> {
  return buildBundle(exampleSrc(name), join(tmpDir, `${name}.cjs`));
}

describe("the server-time example (a new root field + own type)", () => {
  it("builds and validates", async () => {
    const { outfile, sourceFiles } = await buildExample("server-time");
    const result = await validateBundle(outfile, sourceFiles);
    expect(result.resolverTypes).toEqual(["Query"]);
    expect(result.typeDefs).toContain("serverTime");
  });

  it("loads and runs: formats the host-granted clock", async () => {
    const { outfile } = await buildExample("server-time");
    const mod = loadBundleSource(await readFile(outfile, "utf8")) as {
      resolvers: {
        Query: {
          serverTime: (
            p: unknown,
            a: unknown,
            ctx: { now(): number },
          ) => { iso: string; epochMillis: number; timezone: string };
        };
      };
    };
    const fixedNow = 1_781_617_155_421;
    const result = mod.resolvers.Query.serverTime({}, {}, { now: () => fixedNow });
    expect(result.epochMillis).toBe(fixedNow);
    expect(result.timezone).toBe("UTC");
    expect(result.iso).toBe(new Date(fixedNow).toISOString());
  });
});

describe("the loyalty-points example (a field on an existing entity via @interfaceObject)", () => {
  it("builds and validates", async () => {
    const { outfile, sourceFiles } = await buildExample("loyalty-points");
    const result = await validateBundle(outfile, sourceFiles);
    // The resolver lives on the existing `Product` entity, not a new root type.
    expect(result.resolverTypes).toEqual(["Product"]);
    expect(result.typeDefs).toContain("@interfaceObject");
    expect(result.typeDefs).toContain("loyaltyPoints");
  });

  it("loads and runs: computes Product.loyaltyPoints from its argument", async () => {
    const { outfile } = await buildExample("loyalty-points");
    const mod = loadBundleSource(await readFile(outfile, "utf8")) as {
      resolvers: {
        Product: { loyaltyPoints: (p: { id: string }, a: { price: number }) => number };
      };
    };
    // The parent is the entity representation the integration layer resolved
    // (`{ id }`); the field derives from `price` — 1 point per whole currency unit.
    expect(mod.resolvers.Product.loyaltyPoints({ id: "p1" }, { price: 49.95 })).toBe(49);
  });
});

describe("the price-discount example (a field on a nested ProductPrice, computed via @requires)", () => {
  it("builds and validates", async () => {
    const { outfile, sourceFiles } = await buildExample("price-discount");
    const result = await validateBundle(outfile, sourceFiles);
    // The resolver lives on the existing `ProductPrice` nested object.
    expect(result.resolverTypes).toEqual(["ProductPrice"]);
    expect(result.typeDefs).toContain("@requires");
    expect(result.typeDefs).toContain("discountedAmount");
  });

  it("loads and runs: computes ProductPrice.discountedAmount from the @requires'd value", async () => {
    const { outfile } = await buildExample("price-discount");
    const mod = loadBundleSource(await readFile(outfile, "utf8")) as {
      resolvers: {
        ProductPrice: {
          discountedAmount: (
            p: { id: string; value: { centAmount: number } },
            a: { percentOff: number },
          ) => number;
        };
      };
    };
    // The parent carries the `@requires` field `value { centAmount }` the integration
    // layer resolved.
    const price = { id: "pr1", value: { centAmount: 27500 } };
    expect(mod.resolvers.ProductPrice.discountedAmount(price, { percentOff: 10 })).toBe(24750);
    // percentOff is clamped to [0, 100].
    expect(mod.resolvers.ProductPrice.discountedAmount(price, { percentOff: 150 })).toBe(0);
    expect(mod.resolvers.ProductPrice.discountedAmount(price, { percentOff: -5 })).toBe(27500);
  });
});

describe("the address-format example (a field on a shared nested Address via @requires)", () => {
  it("builds and validates", async () => {
    const { outfile, sourceFiles } = await buildExample("address-format");
    const result = await validateBundle(outfile, sourceFiles);
    expect(result.resolverTypes).toEqual(["Address"]);
    expect(result.typeDefs).toContain("@requires");
    expect(result.typeDefs).toContain("formatted");
  });

  it("loads and runs: joins the @requires'd address fields, skipping empty parts", async () => {
    const { outfile } = await buildExample("address-format");
    const mod = loadBundleSource(await readFile(outfile, "utf8")) as {
      resolvers: {
        Address: {
          formatted: (a: {
            id: string | null;
            streetName: string | null;
            city: string | null;
            postalCode: string | null;
            country: string;
          }) => string;
        };
      };
    };
    expect(
      mod.resolvers.Address.formatted({
        id: "VX-yNwth",
        streetName: "Broadway",
        city: "New York",
        postalCode: "10001",
        country: "US",
      }),
    ).toBe("Broadway, New York, 10001, US");
    // Null/blank parts are dropped; country (non-null) always survives.
    expect(
      mod.resolvers.Address.formatted({
        id: null,
        streetName: null,
        city: "Berlin",
        postalCode: "  ",
        country: "DE",
      }),
    ).toBe("Berlin, DE");
  });
});

describe("the cart-sku-blocker example (one bundle: an API Extension AND a GraphQL field, sharing config)", () => {
  type Ctx = { now(): number; config: Record<string, string> };
  type ApiExtension = {
    key: string;
    resourceTypeId: string;
    actions: string[];
    handler: (
      input: { action: string; resource: { typeId: string; id: string; obj?: unknown } },
      ctx: Ctx,
    ) => { errors?: { code: string; message: string }[]; actions?: unknown[] } | void;
  };
  type Bundle = {
    apiExtensions: ApiExtension[];
    resolvers: { Query: { blockedSkus: (p: unknown, a: unknown, ctx: Ctx) => string[] } };
  };

  const cart = (sku: string) => ({
    action: "Create",
    resource: { typeId: "cart", id: "c1", obj: { lineItems: [{ variant: { sku } }] } },
  });

  it("builds and validates: a GraphQL Query field AND an API Extension", async () => {
    const { outfile, sourceFiles } = await buildExample("cart-sku-blocker");
    const result = await validateBundle(outfile, sourceFiles);
    expect(result.typeDefs).not.toBeNull();
    expect(result.typeDefs).toContain("blockedSkus");
    expect(result.resolverTypes).toEqual(["Query"]);
    expect(result.apiExtensionKeys).toEqual(["cart-sku-blocker"]);
  });

  it("loads and runs: the handler blocks a configured SKU, approves others, and honours the comma list", async () => {
    const { outfile } = await buildExample("cart-sku-blocker");
    const mod = loadBundleSource(await readFile(outfile, "utf8")) as Bundle;
    const handler = mod.apiExtensions[0];
    expect(handler.resourceTypeId).toBe("cart");
    expect(handler.actions).toEqual(["Create", "Update"]);

    const ctx: Ctx = { now: () => 0, config: { BLOCKED_SKU: "NO-SELL-123" } };
    const blocked = handler.handler(cart("NO-SELL-123"), ctx);
    expect(blocked).toEqual({
      errors: [{ code: "InvalidInput", message: 'SKU "NO-SELL-123" cannot be added to the cart.' }],
    });
    // A different SKU is approved (empty result).
    expect(handler.handler(cart("FINE"), ctx)).toEqual({});

    // A comma-separated list blocks any SKU in it.
    const listCtx: Ctx = { now: () => 0, config: { BLOCKED_SKU: "A, B" } };
    expect(handler.handler(cart("B"), listCtx)).toEqual({
      errors: [{ code: "InvalidInput", message: 'SKU "B" cannot be added to the cart.' }],
    });
    expect(handler.handler(cart("C"), listCtx)).toEqual({});
  });

  it("loads and runs: Query.blockedSkus returns the same parsed config the handler blocks against", async () => {
    const { outfile } = await buildExample("cart-sku-blocker");
    const mod = loadBundleSource(await readFile(outfile, "utf8")) as Bundle;
    const blockedSkus = mod.resolvers.Query.blockedSkus;
    // The comma-separated list is parsed (trimmed, empties dropped).
    expect(blockedSkus(undefined, undefined, { now: () => 0, config: { BLOCKED_SKU: "A, B" } })).toEqual(["A", "B"]);
    // No config → the default.
    expect(blockedSkus(undefined, undefined, { now: () => 0, config: {} })).toEqual(["BLOCKED-SKU"]);
  });
});

describe("the algolia-recommendations example (uses the official SDK over the global fetch)", () => {
  type Recommendation = { product: { id: string }; reason: string };
  // The resolver uses the official `algoliasearch` SDK, whose fetch transport calls
  // the global `fetch`. We stub that global `fetch` to drive the SDK.
  type Ctx = { now(): number; config: Record<string, string> };
  // The Algolia connection the resolvers read from ctx.config (set per project via
  // the integration layer). The SDK targets `<appId>-dsn.algolia.net` / `*.algolianet.com`.
  const ALGOLIA_TEST_CONFIG = {
    ALGOLIA_APP_ID: "TESTAPPID",
    ALGOLIA_API_KEY: "test-search-key",
    ALGOLIA_INDEX_NAME: "GCP_US_TEST",
  };
  type RecommendationsResolver = (
    product: { id: string },
    args: unknown,
    ctx: Ctx,
  ) => Promise<Recommendation[] | null>;

  type ProductStub = { id: string };
  type FacetResult = { name: string; buckets: { key: string; count: number }[] };
  type ProductSearchResult = {
    items: ProductStub[];
    total: number;
    count: number;
    facets: FacetResult[];
    facetDefinitions: unknown[];
    nextCursor: string | null;
    previousCursor: string | null;
  };
  type ProductSearchResolver = (
    parent: unknown,
    args: { input: { query?: string; limit?: number; cursor?: string } },
    ctx: Ctx,
  ) => Promise<ProductSearchResult>;

  /**
   * Replace the global `fetch` the SDK calls with a stub that records request URLs
   * and returns `body` as the JSON response — or throws, to exercise the SDK's
   * failure path. Restores `fetch` afterwards.
   */
  async function withFetchStub(
    body: Record<string, unknown> | (() => never),
    fn: (urls: string[]) => Promise<void>,
  ): Promise<void> {
    const original = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      urls.push(typeof input === "string" ? input : String(input));
      if (typeof body === "function") body();
      const text = JSON.stringify(body);
      return {
        status: 200,
        ok: true,
        text: async () => text,
        json: async () => JSON.parse(text),
        headers: { get: () => null },
      } as unknown as Awaited<ReturnType<typeof fetch>>;
    }) as typeof fetch;
    try {
      await fn(urls);
    } finally {
      globalThis.fetch = original;
    }
  }

  async function loadBundle() {
    const { outfile } = await buildExample("algolia-recommendations");
    return loadBundleSource(await readFile(outfile, "utf8")) as {
      resolvers: {
        Product: { recommendations: RecommendationsResolver };
        Query: { productSearch: ProductSearchResolver };
      };
    };
  }

  it("builds and validates", async () => {
    const { outfile, sourceFiles } = await buildExample("algolia-recommendations");
    const result = await validateBundle(outfile, sourceFiles);
    // It adds a field to the `Product` entity AND overrides `Query.productSearch`.
    expect(result.resolverTypes).toEqual(["Query", "Product"]);
    expect(result.typeDefs).toContain("@interfaceObject");
    expect(result.typeDefs).toContain("recommendations");
    expect(result.typeDefs).toContain('@override(from: "integration-layer")');
  });

  it("productSearch maps Algolia hits to Product stubs + facets (SDK over the global fetch)", async () => {
    const productSearch = (await loadBundle()).resolvers.Query.productSearch;
    await withFetchStub(
      {
        hits: [{ objectID: "p1" }, { objectID: "p2" }, { notAnId: true }],
        nbHits: 42,
        facets: { color: { red: 3, blue: 5 } },
      },
      async (urls) => {
        const result = await productSearch({}, { input: { query: "drill", limit: 2 } }, {
          now: () => 0,
          config: ALGOLIA_TEST_CONFIG,
        });

        // Items are bare Product stubs (the router join-resolves their rich detail).
        expect(result.items).toEqual([{ id: "p1" }, { id: "p2" }]);
        expect(result.total).toBe(42);
        expect(result.count).toBe(2);
        expect(result.facets).toEqual([
          { name: "color", buckets: [{ key: "red", count: 3 }, { key: "blue", count: 5 }] },
        ]);
        expect(result.facetDefinitions).toEqual([]);
        // More hits remain (count 2 < total 42) → a next cursor; no previous on page 1.
        expect(result.nextCursor).toBe("offset:2");
        expect(result.previousCursor).toBeNull();
        // The SDK reached Algolia's search endpoint for the configured index.
        expect(urls.some((u) => u.includes("/1/indexes/GCP_US_TEST/query"))).toBe(true);
        // …on an Algolia host.
        expect(urls[0]).toMatch(/algolia(net)?\.(net|com)/);
      },
    );
  });

  it("loads and runs: maps Algolia hits to recommendations (SDK over the global fetch)", async () => {
    const recommendations = (await loadBundle()).resolvers.Product.recommendations;
    await withFetchStub(
      { results: [{ hits: [{ objectID: "p2" }, { objectID: "p3" }] }] },
      async (urls) => {
        const result = await recommendations({ id: "p1" }, {}, {
          now: () => 0,
          config: ALGOLIA_TEST_CONFIG,
        });

        expect(result).toEqual([
          { product: { id: "p2" }, reason: "related product" },
          { product: { id: "p3" }, reason: "related product" },
        ]);
        // It reached Algolia's Recommend endpoint.
        expect(urls.some((u) => u.includes("/indexes/*/recommendations"))).toBe(true);
      },
    );
  });

  it("degrades to null when the Algolia call fails (nullable field)", async () => {
    const recommendations = (await loadBundle()).resolvers.Product.recommendations;
    await withFetchStub(
      () => {
        throw new Error("algolia down");
      },
      async () => {
        expect(
          await recommendations({ id: "p1" }, {}, { now: () => 0, config: ALGOLIA_TEST_CONFIG }),
        ).toBeNull();
      },
    );
  });

  it("degrades when ctx.config has no Algolia connection (recommendations → null, productSearch → empty)", async () => {
    const bundle = await loadBundle();
    await withFetchStub(
      () => {
        throw new Error("must not be called when unconfigured");
      },
      async (urls) => {
        const ctx = { now: () => 0, config: {} };
        // No config → never constructs the SDK client or touches the network.
        expect(await bundle.resolvers.Product.recommendations({ id: "p1" }, {}, ctx)).toBeNull();
        const search = await bundle.resolvers.Query.productSearch({}, { input: {} }, ctx);
        expect(search.items).toEqual([]);
        expect(search.total).toBe(0);
        expect(urls).toEqual([]);
      },
    );
  });
});
