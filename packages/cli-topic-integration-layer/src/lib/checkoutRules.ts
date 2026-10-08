import type { CheckoutMode, CheckoutRule } from "./ilClient.js";

export const CHECKOUT_MODES: readonly CheckoutMode[] = ["PAYMENT_ONLY", "COMPLETE"];

const COUNTRY = /^[A-Z]{2}$/;
const STORE_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Split values that may be repeated and/or comma-separated into a trimmed, de-duplicated
 * list, dropping blanks. Countries are upper-cased (case-insensitive input); store keys
 * are kept verbatim — commercetools keys are case-sensitive.
 */
export function splitList(values: readonly string[], upper: boolean): string[] {
  const seen = new Set<string>();
  for (const raw of values.flatMap((v) => v.split(","))) {
    const value = upper ? raw.trim().toUpperCase() : raw.trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

/**
 * Build one rule, applying the checks the Merchant Center runs before saving. An empty
 * `countries` / `stores` list is omitted, which means "any" on that axis.
 */
export function buildRule(input: {
  countries?: readonly string[];
  stores?: readonly string[];
  applicationKey: unknown;
  mode: unknown;
}): CheckoutRule {
  const applicationKey = typeof input.applicationKey === "string" ? input.applicationKey.trim() : "";
  if (!applicationKey) throw new Error("A rule needs a Checkout Application key.");
  if (input.mode === undefined || input.mode === null || input.mode === "") {
    throw new Error(`A rule needs a mode (${CHECKOUT_MODES.join(" or ")}).`);
  }
  if (!CHECKOUT_MODES.includes(input.mode as CheckoutMode)) {
    throw new Error(`Invalid mode '${String(input.mode)}' (use ${CHECKOUT_MODES.join(" or ")}).`);
  }
  const countries = splitList(input.countries ?? [], true);
  const badCountry = countries.find((c) => !COUNTRY.test(c));
  if (badCountry) {
    throw new Error(`'${badCountry}' is not a valid country (use ISO 3166-1 alpha-2, e.g. DE).`);
  }
  const stores = splitList(input.stores ?? [], false);
  const badStore = stores.find((s) => !STORE_KEY.test(s));
  if (badStore) throw new Error(`'${badStore}' is not a valid store key.`);

  const rule: CheckoutRule = { applicationKey, mode: input.mode as CheckoutMode };
  if (countries.length > 0) rule.countries = countries;
  if (stores.length > 0) rule.stores = stores;
  return rule;
}

/**
 * Parse a rules document: either a bare array of rules or `{ "rules": [...] }`. Each
 * rule has `applicationKey`, `mode` and optional `countries` / `stores` string arrays.
 */
export function parseRules(json: string): CheckoutRule[] {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch (e) {
    throw new Error(`Rules are not valid JSON: ${(e as Error).message}`);
  }
  const list = Array.isArray(doc) ? doc : (doc as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(list)) {
    throw new Error('Expected a JSON array of rules, or an object like { "rules": [...] }.');
  }
  if (list.length === 0) throw new Error("At least one rule is required.");
  return list.map((raw, i) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Rule ${i + 1}: expected an object.`);
    }
    const r = raw as Record<string, unknown>;
    for (const axis of ["countries", "stores"] as const) {
      const v = r[axis];
      if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === "string"))) {
        throw new Error(`Rule ${i + 1}: '${axis}' must be an array of strings.`);
      }
    }
    try {
      return buildRule({
        countries: r.countries as string[] | undefined,
        stores: r.stores as string[] | undefined,
        applicationKey: r.applicationKey,
        mode: r.mode,
      });
    } catch (e) {
      throw new Error(`Rule ${i + 1}: ${(e as Error).message}`);
    }
  });
}

/** One-line summary of a rule, numbered from 1 in match order. */
export function formatRule(rule: CheckoutRule, index: number): string {
  const countries = rule.countries?.join(", ") ?? "any";
  const stores = rule.stores?.join(", ") ?? "any";
  return `${index + 1}. countries: ${countries} | stores: ${stores} → ${rule.applicationKey} (${rule.mode})`;
}

/** Print a rule list (or "(none)") through `log`, indented. */
export function logRules(rules: readonly CheckoutRule[], log: (line: string) => void): void {
  if (rules.length === 0) log("  (none)");
  rules.forEach((rule, i) => log(`  ${formatRule(rule, i)}`));
}
