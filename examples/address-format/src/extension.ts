/**
 * Example extension — the `@requires` pattern over SCALAR fields: a field on a shared,
 * embedded object (`Address.formatted`). A close cousin of `examples/price-discount`,
 * but the required data is plain scalars directly on the type, so it needs no extra
 * value type — just `@external` on the scalars it consumes.
 *
 * Two things to know about `Address`:
 *   - It is **shared** — one `Address` type, reached from a Customer, BusinessUnit,
 *     Cart, and Order — so a field you add here appears on EVERY address.
 *   - It is keyed by **`id` and its `key`**. This template keys by `id`; on a
 *     Customer/BusinessUnit `id` is mandatory, so it always resolves there. Both keys
 *     are declared **nullable** because a Cart/Order inline address may have no `id`
 *     (only a `key`, or neither) — key by `key` if you target inline addresses.
 *
 * An independent, project-agnostic template. Edit this file, then run `pnpm validate`
 * / `pnpm push` from this directory (the target project comes from the shared `.env`).
 * Exports `typeDefs` + `resolvers`; runs in a restricted runtime — see the README's
 * "Authoring constraints".
 */

export const typeDefs = `
  extend schema @link(
    url: "https://specs.apollo.dev/federation/v2.3"
    import: ["@key", "@requires", "@external"]
  )

  "A field this subgraph attaches to every address, computed from the address's own fields."
  type Address @key(fields: "id") {
    id: ID
    "Owned and resolved by the integration layer — referenced via @requires, never resolved here."
    streetName: String @external
    city: String @external
    postalCode: String @external
    country: String! @external
    "A single-line address, e.g. \\"Broadway, New York, 10001, US\\". Empty parts are skipped."
    formatted: String! @requires(fields: "streetName city postalCode country")
  }
`;

export const resolvers = {
  Address: {
    // The parent is the entity representation the integration layer resolved —
    // `{ id }` plus the `@requires` scalar fields. The field is a pure join of those
    // fields, so it touches no host capability or network — trivially safe. `country`
    // is non-null; the rest may be null/empty and are dropped from the line.
    formatted: (address: {
      id: string | null;
      streetName: string | null;
      city: string | null;
      postalCode: string | null;
      country: string;
    }): string =>
      [address.streetName, address.city, address.postalCode, address.country]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(", "),
  },
};
