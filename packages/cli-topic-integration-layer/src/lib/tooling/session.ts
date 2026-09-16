// Session bearers for the local explorer's proxy.
//
// The explorer runs operations against the DEPLOYED edge, so it needs the same
// credential a storefront would carry: an integration-layer session bearer, minted
// through the ordinary `POST /<project>/session` endpoint.
//
// There is deliberately NO privileged/debug path here. The two grants below are the
// two a real storefront uses — anonymous, and a customer logging in with their own
// email and password. The retired operator console had an `x-il-act-as`
// impersonation bar that ran under the project's service-account credentials; that
// is exactly what this does not reimplement. If you want to explore as a customer,
// you log in as that customer.
//
// PRESENTMENT (locale / currency / country) rides the same mint call. The GraphQL
// boundary reads all three straight off the session and FAILS the request if any is
// missing — there is no `?? "en-US"` downstream — so a session is only ever minted
// with them resolved. Mint is the one place they can be chosen: the integration
// layer applies its own project-configured defaults when we send none, exactly as
// it does for a storefront that has no locale switcher. Passing them here is
// therefore the storefront's own flow, not a debug override.

/** Which identity the explorer's proxy runs operations as. */
export type SessionGrant =
  | { kind: "anonymous" }
  | { kind: "password"; email: string; password: string };

/**
 * An explicit presentment selection, as a storefront's locale/currency switcher
 * would send it. Every field is optional and independently defaulted by the
 * Commerce Integration Layer from the project config, so `{ currency: "EUR" }` alone is
 * valid — it changes the currency and leaves locale and country at the project's.
 */
export interface Presentment {
  locale?: string;
  currency?: string;
  country?: string;
}

/** A minted session, plus human labels for the startup banner. */
export interface MintedSession {
  token: string;
  /** e.g. `anonymous` or `customer alice@example.com` — printed, never logged elsewhere. */
  describe: string;
  /** e.g. `de-DE / EUR / DE` or `project defaults` — what prices will be shown in. */
  presentment: string;
}

/**
 * The business unit / store a B2B session is scoped to. BOTH are required by the
 * integration layer: a store proves membership of the business unit, so it cannot
 * be inferred. Selection is a SECOND call — the mint endpoint takes no BU.
 */
export interface BusinessUnitScope {
  businessUnitKey: string;
  storeKey: string;
}

/** A reissued session after a business-unit selection. */
export interface ScopedSession {
  token: string;
  /** e.g. `BU acme-eu / store acme-eu-de` — appended to the banner's `running as`. */
  describe: string;
}

/**
 * Mint an integration-layer session bearer at `POST <authUrl>/<project>/session`.
 *
 * `authUrl` is the identity edge, NOT the extensions edge that
 * serves the manage-surface routes — in the deployed topology those are different
 * hosts (`auth.…` vs `extensions.…`), which is why the explorer resolves them
 * separately.
 */
export async function mintSession(
  authUrl: string,
  projectKey: string,
  grant: SessionGrant,
  presentment: Presentment = {},
): Promise<MintedSession> {
  const base = authUrl.replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(projectKey)}/session`;
  const identity =
    grant.kind === "anonymous"
      ? { grant_type: "anonymous" }
      : { grant_type: "password", email: grant.email, password: grant.password };
  // Currency and country are upper-cased to the canonical form the session will
  // hold (the Commerce Integration Layer upper-cases them too, so `--currency eur` already
  // worked) — done here so the banner reports the value the session actually got
  // rather than echoing back what was typed. Locale keeps its case: `de-DE` is not
  // `DE-DE`.
  const chosen: Presentment = {
    locale: presentment.locale,
    currency: presentment.currency?.toUpperCase(),
    country: presentment.country?.toUpperCase(),
  };
  // Only send what was actually chosen: an absent key means "use the project's
  // default", which is a different instruction to sending an empty string.
  const body = {
    ...identity,
    ...(chosen.locale === undefined ? {} : { locale: chosen.locale }),
    ...(chosen.currency === undefined ? {} : { currency: chosen.currency }),
    ...(chosen.country === undefined ? {} : { country: chosen.country }),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Surface the Commerce Integration Layer's own error (an OAuth-shaped
    // `{ error, error_description }`) rather than a bare status — a bad password
    // and an unreachable edge should not read the same.
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error_description?: string; error?: string };
      detail = parsed.error_description ?? parsed.error ?? text;
    } catch {
      // not JSON — use the raw body
    }
    const who = grant.kind === "anonymous" ? "an anonymous session" : `a session for ${grant.email}`;
    throw new Error(`could not mint ${who} (${res.status}) at ${url}: ${detail}`);
  }

  const token = (JSON.parse(text) as { token?: string }).token;
  if (!token) throw new Error(`session response from ${url} had no \`token\``);

  return {
    token,
    describe: grant.kind === "anonymous" ? "anonymous" : `customer ${grant.email}`,
    presentment: describePresentment(chosen),
  };
}

/**
 * Select a business unit and store on an already-minted session, at
 * `PUT <authUrl>/<project>/session/business-unit`.
 *
 * This is the SECOND step of the B2B flow: mint cannot take a business unit (the
 * server rejects it), so a customer session is minted first and then scoped here.
 * `bearer` is the token from that mint; the server proves the customer's membership
 * of the business unit by an as-associate read, and rejects a store that is not in
 * the unit with `StoreNotInBusinessUnitError`. The reissued token REPLACES the mint
 * token — it carries the store's distribution channel — so callers must swap it in.
 *
 * `authUrl` is the same identity edge `mintSession` uses, NOT the extensions edge.
 */
export async function selectBusinessUnit(
  authUrl: string,
  projectKey: string,
  bearer: string,
  scope: BusinessUnitScope,
): Promise<ScopedSession> {
  const base = authUrl.replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(projectKey)}/session/business-unit`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      businessUnitKey: scope.businessUnitKey,
      storeKey: scope.storeKey,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    // Same OAuth-shaped error surfacing as mintSession: a bad store key (a 4xx with
    // a `StoreNotInBusinessUnitError` description) and an unreachable edge must not
    // read the same.
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error_description?: string; error?: string };
      detail = parsed.error_description ?? parsed.error ?? text;
    } catch {
      // not JSON — use the raw body
    }
    throw new Error(
      `could not select business unit '${scope.businessUnitKey}' / store '${scope.storeKey}' ` +
        `(${res.status}) at ${url}: ${detail}`,
    );
  }

  const token = (JSON.parse(text) as { token?: string }).token;
  if (!token) throw new Error(`business-unit response from ${url} had no \`token\``);

  return {
    token,
    describe: `BU ${scope.businessUnitKey} / store ${scope.storeKey}`,
  };
}

/**
 * What the banner says prices will be shown in. Reports what was REQUESTED, marking
 * the rest as the project's — the mint response carries the token only, so claiming
 * a concrete value we did not choose would mean decoding the session JWT and
 * depending on its internal shape.
 */
function describePresentment(p: Presentment): string {
  const parts = [
    p.locale ?? "project locale",
    p.currency ?? "project currency",
    p.country ?? "project country",
  ];
  if (!p.locale && !p.currency && !p.country) return "project defaults";
  return parts.join(" / ");
}
