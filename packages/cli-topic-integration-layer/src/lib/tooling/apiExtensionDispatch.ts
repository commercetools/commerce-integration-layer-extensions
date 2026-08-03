// Run a bundle's commercetools API-Extension handlers for one callback and map the
// merged result to the commercetools response contract. Kept PURE (no HTTP, no
// module state) so it's unit-tested directly and shared by two callers:
//   - `invoke-api-extension` fires a SYNTHETIC payload at the handlers offline;
//   - `serve-api-extension` serves the handlers over HTTP so REAL commercetools
//     callbacks reach them for local end-to-end debugging.
//
// This mirrors the sandbox runtime's dispatch contract
// (octolog-extensions-sandbox `service/src/apiExtensions/dispatch.ts`) so a handler
// behaves identically locally and once deployed. The one deliberate difference is
// that handlers run here in plain Node (no SES compartment, no `harden`) — that is
// what makes breakpoints and stack traces work; `validate`/`push` remain the
// correctness gate for the real sandbox endowments.

import type { EvaluatedBundle } from "./loadBundle.js";
import type {
  ApiExtensionAction,
  ApiExtensionDefinition,
  ApiExtensionError,
  ApiExtensionInput,
  ApiExtensionResult,
  ExtensionContext,
} from "./apiExtension.js";

/** The wire result: the HTTP status commercetools expects, plus the optional body. */
export interface DispatchResult {
  status: number;
  /** Omitted for a bare approve (empty 200 body). */
  body?: { actions: unknown[] } | { errors: ApiExtensionError[] };
}

/** Pull the `apiExtensions` array off a loaded bundle (empty when it exports none). */
export function extractApiExtensions(mod: EvaluatedBundle): ApiExtensionDefinition[] {
  return Array.isArray(mod.apiExtensions) ? (mod.apiExtensions as ApiExtensionDefinition[]) : [];
}

/** Whether a handler is triggered by a given commercetools resource + action. */
export function handlerMatches(
  handler: ApiExtensionDefinition,
  resourceTypeId: string,
  action: ApiExtensionAction,
): boolean {
  return handler.resourceTypeId === resourceTypeId && handler.actions.includes(action);
}

/** Summarise a single handler's result for a human-readable log line. */
export function describeResult(result: ApiExtensionResult): string {
  if (result && typeof result === "object") {
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      return `BLOCK — ${result.errors.map((e) => `${e.code}: ${e.message}`).join("; ")}`;
    }
    if (Array.isArray(result.actions) && result.actions.length > 0) {
      return `MODIFY — ${JSON.stringify(result.actions)}`;
    }
  }
  return "APPROVE";
}

/**
 * Dispatch one commercetools API-Extension callback across the matching handlers and
 * return the response commercetools expects:
 *
 * - No matching handler → approve (200, no body): no handler expresses an opinion, so
 *   the write proceeds (the defined behaviour, not a fallback).
 * - Any handler returns `errors` → BLOCK (400 with the merged errors).
 * - Otherwise merge any `actions` → 200 with the actions (or an empty 200).
 *
 * FAIL FAST: a handler that throws is NOT swallowed into an approve — the error
 * propagates to the caller, which returns 500 so commercetools fails the write loudly
 * (the same contract as the deployed sandbox).
 */
export async function dispatchApiExtension(
  handlers: ApiExtensionDefinition[],
  ctx: ExtensionContext,
  input: ApiExtensionInput,
): Promise<DispatchResult> {
  const matching = handlers.filter((h) =>
    // input.action is the SDK's (open) ExtensionAction; our handlers only declare
    // Create/Update, so a non-matching action simply finds no handler.
    handlerMatches(h, input.resource.typeId, input.action as ApiExtensionAction),
  );
  if (matching.length === 0) return { status: 200 };

  const errors: ApiExtensionError[] = [];
  const actions: unknown[] = [];
  for (const h of matching) {
    const result = await h.handler(input, ctx);
    if (result && typeof result === "object") {
      if (Array.isArray(result.errors)) errors.push(...result.errors);
      if (Array.isArray(result.actions)) actions.push(...result.actions);
    }
  }

  if (errors.length > 0) return { status: 400, body: { errors } };
  if (actions.length > 0) return { status: 200, body: { actions } };
  return { status: 200 };
}
