import { describe, expect, it } from "vitest";

import { isIntrospectionRequest } from "../../src/lib/tooling/introspectionRequest.js";

// This predicate routes a request to one of two places, and BOTH misclassifications
// are silent failures: a real query answered locally returns nulls (no resolvers),
// and introspection sent to the edge comes back refused (no docs). So the cases
// below are about the boundary, not the happy path.
describe("isIntrospectionRequest", () => {
  it("recognises GraphiQL's introspection", () => {
    expect(isIntrospectionRequest("{ __schema { queryType { name } } }")).toBe(true);
    expect(isIntrospectionRequest("query { __type(name: \"Query\") { name } }")).toBe(true);
    expect(isIntrospectionRequest("query IntrospectionQuery { __schema { types { name } } }")).toBe(
      true,
    );
  });

  it("treats an ordinary query as an ordinary query", () => {
    expect(isIntrospectionRequest("{ categories { items { name } } }")).toBe(false);
    expect(isIntrospectionRequest("query Cart { cart { id } }")).toBe(false);
  });

  it("does NOT match a real query that merely mentions __schema in a string", () => {
    // The string-matching version of this check would send it to the local schema
    // and answer with nulls.
    expect(isIntrospectionRequest('{ productSearch(text: "__schema") { total } }')).toBe(false);
  });

  it("does NOT match a real field aliased to look like introspection", () => {
    expect(isIntrospectionRequest("{ __aliased: categories { total } }")).toBe(false);
  });

  it("sends a MIXED operation to the edge rather than half-answering it locally", () => {
    // Half of this needs real resolvers, so answering locally would return null data
    // for `categories`. The edge refuses the `__schema` half — the honest answer.
    expect(isIntrospectionRequest("{ __schema { types { name } } categories { total } }")).toBe(
      false,
    );
  });

  it("never treats a mutation as introspection", () => {
    expect(isIntrospectionRequest("mutation { __typename }")).toBe(false);
  });

  it("honours operationName when the document holds several operations", () => {
    const doc = "query Intro { __schema { types { name } } }\nquery Real { categories { total } }";
    expect(isIntrospectionRequest(doc, "Intro")).toBe(true);
    expect(isIntrospectionRequest(doc, "Real")).toBe(false);
    // Ambiguous (multiple operations, none named) → not introspection, so the edge
    // returns the proper "must provide operation name" error.
    expect(isIntrospectionRequest(doc)).toBe(false);
  });

  it("forwards unparseable input so the EDGE produces the syntax error", () => {
    expect(isIntrospectionRequest("{ __schema {")).toBe(false);
    expect(isIntrospectionRequest("")).toBe(false);
  });
});
