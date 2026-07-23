/**
 * Example extension — the `@requires` pattern over SCALAR fields: a field computed
 * from an entity's own plain scalar fields (`Customer.displayName`). A close cousin of
 * `examples/price-discount`, but the required data is plain scalars directly on the
 * type, so it needs no extra value type — just `@external` on the scalars it consumes.
 *
 * The integration layer exposes `Customer` as a Federation entity keyed by `id`. This
 * subgraph adds `displayName`, computed from the customer's `firstName` + `lastName`,
 * pulled in with `@requires`. The key field `id` is declared NORMALLY (not
 * `@external`) — it is the entity key; marking a key field `@external` stops the
 * planner from satisfying `@requires`. Only the fields OWNED by the integration layer
 * (`firstName`, `lastName`) are `@external`.
 *
 * (v2 note: v1 shipped an `address-format` example that extended a keyed `Address`
 * entity. v2 makes `Address` a keyless embedded snapshot and moves the address book to
 * `SavedAddress`, neither of which is an extensible/join-target entity — so the same
 * "@requires over scalars" lesson lives here on `Customer` instead.)
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

  "A field this subgraph attaches to every customer, computed from the customer's own fields."
  type Customer @key(fields: "id") {
    id: ID!
    "Owned and resolved by the integration layer — referenced via @requires, never resolved here."
    firstName: String! @external
    lastName: String! @external
    "A single display name, e.g. \\"Ada Lovelace\\". Empty parts are skipped."
    displayName: String! @requires(fields: "firstName lastName")
  }
`;

export const resolvers = {
  Customer: {
    // The parent is the entity representation the integration layer resolved —
    // `{ id }` plus the `@requires` scalar fields. The field is a pure join of those
    // fields, so it touches no host capability or network — trivially safe. Both
    // parts are non-null in v2, but we still skip empties defensively so a blank part
    // never leaves a stray space.
    displayName: (customer: { id: string; firstName: string; lastName: string }): string =>
      [customer.firstName, customer.lastName]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(" "),
  },
};
