// The commercetools project resource (`GET /{projectKey}` on the platform API), read for
// the menus a project presents: its languages, countries and currencies. The Commerce
// Integration Layer validates a shopper's choice against the same lists, but stores the
// project's default settings without checking them — so `project-settings set` checks
// them here, the way the Merchant Center's dropdowns do. The same authenticated fetch
// carries the `manage_project` bearer; nothing here sets an Authorization header.

import { ctApiBaseUrl, type AuthFetch } from "./ctExtensions.js";

/** What a project can be presented in: BCP-47 language tags, ISO 3166-1 countries, ISO 4217 currencies. */
export interface ProjectPresentment {
  languages: string[];
  countries: string[];
  currencies: string[];
}

/** Which `project-settings` field a value is checked as. */
export type PresentmentField = "language" | "country" | "currency";

const MENU: Record<PresentmentField, keyof ProjectPresentment> = {
  language: "languages",
  country: "countries",
  currency: "currencies",
};

/** Read the project's presentment menus from the commercetools platform API. */
export async function fetchProjectPresentment(
  region: string,
  projectKey: string,
  authFetch: AuthFetch,
): Promise<ProjectPresentment> {
  const url = `${ctApiBaseUrl(region)}/${encodeURIComponent(projectKey)}`;
  const res = await authFetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET commercetools project '${projectKey}' failed (${res.status}): ${text}`);
  }
  const { languages, countries, currencies } = JSON.parse(text) as Partial<ProjectPresentment>;
  // Required on the project resource: a missing list is a broken read, not an empty project.
  if (!Array.isArray(languages) || !Array.isArray(countries) || !Array.isArray(currencies)) {
    throw new Error(`commercetools project '${projectKey}' reported no languages/countries/currencies`);
  }
  return { languages, countries, currencies };
}

/**
 * The project's own spelling of `value` for `field` (matched case-insensitively, so
 * `de` finds `DE` and `en-us` finds `en-US`), or throws naming what the project does
 * present.
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
