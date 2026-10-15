import type { ProjectPresentment } from "./ilClient.js";

/** Which `project-settings` field a value is checked as. */
export type PresentmentField = "language" | "country" | "currency";

const MENU: Record<PresentmentField, keyof ProjectPresentment> = {
  language: "languages",
  country: "countries",
  currency: "currencies",
};

/**
 * The project's own spelling of `value` for `field` (matched case-insensitively, so `de`
 * finds `DE` and `en-us` finds `en-US`), or throws naming what the project does present.
 *
 * The Commerce Integration Layer stores the default settings without checking them and
 * later seeds new shopper sessions with them, so a value the project doesn't present would
 * only fail there. This is the check the Merchant Center's dropdowns make by construction.
 */
export function canonicalisePresentment(
  presentment: ProjectPresentment,
  projectKey: string,
  field: PresentmentField,
  value: string,
): string {
  const offered = presentment[MENU[field]];
  const match = offered.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
  if (match === undefined) {
    throw new Error(
      `Project '${projectKey}' does not present ${field} '${value}'. It presents: ${offered.join(", ") || "(none)"}.`,
    );
  }
  return match;
}
