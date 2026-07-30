// Does this operation need answering LOCALLY?
//
// The explorer answers introspection itself, from the schema it resolved, because
// the deployed edge has introspection disabled — that is the whole point of the
// arrangement. Everything else is proxied to the edge.
//
// So this predicate decides which of two very different things happens to a request,
// and both misclassifications are bad:
//
//   a real query judged introspection  → executed against a schema with NO resolvers,
//                                        silently returning nulls instead of data
//   introspection judged a real query  → forwarded to an edge that refuses it, so
//                                        GraphiQL shows no docs
//
// Hence: parse and inspect the operation, never string-match. A query that merely
// MENTIONS `__schema` — in a string literal, a variable default, or as an alias —
// is a real query.

import { getOperationAST, parse } from "graphql";

/**
 * True when `query`'s selected operation is a query whose every top-level selection
 * is an introspection meta-field (`__schema`, `__type`, `__typename`).
 *
 * Unparseable input is NOT introspection: forwarding it lets the edge produce the
 * error, which is the same message the developer would get in production.
 *
 * A mixed operation (`{ __schema { … } categories { … } }`) is also not
 * introspection — it needs real resolvers, so it goes to the edge and the edge
 * refuses the `__schema` half. That is the honest answer: the edge genuinely can't
 * serve it, and pretending otherwise would return half-null data.
 */
export function isIntrospectionRequest(query: string, operationName?: string): boolean {
  let document;
  try {
    document = parse(query);
  } catch {
    return false;
  }

  const operation = getOperationAST(document, operationName ?? undefined);
  if (!operation || operation.operation !== "query") return false;

  const selections = operation.selectionSet.selections;
  if (selections.length === 0) return false;

  return selections.every(
    (selection) => selection.kind === "Field" && selection.name.value.startsWith("__"),
  );
}
