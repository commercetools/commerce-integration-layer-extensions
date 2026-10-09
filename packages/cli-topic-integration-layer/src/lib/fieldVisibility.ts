import type { FieldVisibilityRow, SourceCoordinate, VisibilityReason } from "./ilClient.js";

export const SPACES = ["customField", "attribute"] as const;

// The Commerce Integration Layer's own bounds on a stored rule set. Checked here so the
// error appears before the request; the backend enforces the same limits.
export const MAX_IDENTIFIER_LENGTH = 256;
export const MAX_RULES = 500;

/** Throw when a coordinate or the whole rule set exceeds the backend's bounds. */
export function assertWithinLimits(coordinates: readonly SourceCoordinate[]): void {
  if (coordinates.length > MAX_RULES) {
    throw new Error(`At most ${MAX_RULES} hidden fields are supported (got ${coordinates.length}).`);
  }
  for (const c of coordinates) {
    if (c.typeKey.length > MAX_IDENTIFIER_LENGTH || c.fieldName.length > MAX_IDENTIFIER_LENGTH) {
      throw new Error(
        `${formatCoordinate(c)} has an identifier longer than ${MAX_IDENTIFIER_LENGTH} characters.`,
      );
    }
  }
}

/** Whether a stored rule names this row — the stored rule set is the rows answering yes. */
export const hasRule = (row: FieldVisibilityRow): boolean =>
  row.active || row.reason !== undefined;

/** Stable identity of a coordinate. JSON, not a joined string: the keys are merchant-authored. */
export const coordinateKey = (c: SourceCoordinate): string =>
  JSON.stringify([c.space, c.typeKey, c.fieldName]);

/** Display form only — identity always goes through {@link coordinateKey}. */
export const formatCoordinate = (c: SourceCoordinate): string =>
  `${c.typeKey} / ${c.fieldName} (${c.space})`;

/** The stored rules, read off the annotated rows. */
export const storedRules = (rows: readonly FieldVisibilityRow[]): SourceCoordinate[] =>
  rows.filter(hasRule).map((row) => row.coordinate);

const REASON_TEXT: Record<VisibilityReason, string> = {
  noSuchType: "the type does not exist in this project",
  noSuchField: "the field does not exist on that type",
  notInSchema: "the field has no GraphQL counterpart",
};

export const reasonText = (reason: VisibilityReason): string => REASON_TEXT[reason];

/** Parse a rules document: a bare array of coordinates, or `{ "hiddenFields": [...] }`. */
export function parseCoordinates(json: string): SourceCoordinate[] {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch (e) {
    throw new Error(`Rules are not valid JSON: ${(e as Error).message}`);
  }
  const list = Array.isArray(doc) ? doc : (doc as { hiddenFields?: unknown } | null)?.hiddenFields;
  if (!Array.isArray(list)) {
    throw new Error('Expected a JSON array of coordinates, or an object like { "hiddenFields": [...] }.');
  }
  const seen = new Set<string>();
  const out: SourceCoordinate[] = [];
  list.forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    for (const key of ["space", "typeKey", "fieldName"] as const) {
      if (typeof r[key] !== "string" || r[key] === "") {
        throw new Error(`Rule ${i + 1}: '${key}' must be a non-empty string.`);
      }
    }
    if (!(SPACES as readonly string[]).includes(r.space as string)) {
      throw new Error(`Rule ${i + 1}: 'space' must be ${SPACES.join(" or ")}, not '${String(r.space)}'.`);
    }
    const coordinate = { space: r.space, typeKey: r.typeKey, fieldName: r.fieldName } as SourceCoordinate;
    if (!seen.has(coordinateKey(coordinate))) {
      seen.add(coordinateKey(coordinate));
      out.push(coordinate);
    }
  });
  assertWithinLimits(out);
  return out;
}

/** Print coordinates indented, or "(none)". */
export function logCoordinates(
  coordinates: readonly SourceCoordinate[],
  log: (line: string) => void,
): void {
  if (coordinates.length === 0) log("  (none)");
  for (const c of coordinates) log(`  ${formatCoordinate(c)}`);
}

/** Shown after a save whose republish went through. */
export const REPUBLISHED = "The schema was republished.";

/** The save was stored but the republish failed, so the published schema is behind the rules. */
export const PUBLISH_PENDING =
  "The rules are saved, but republishing the schema failed — the published schema does not reflect them yet. Use “Refresh schema” on the Schema tab in the Merchant Center, or re-run this command.";
