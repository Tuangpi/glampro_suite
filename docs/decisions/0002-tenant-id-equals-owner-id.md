# 0002 — A migrated tenant keeps the owner's legacy `users.id`

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** product owner, engineering
- **Related:** [`../saas/TENANCY.md`](../saas/TENANCY.md) §2.1, [`../legacy/LEGACY-MAP.md`](../legacy/LEGACY-MAP.md) §3, [`../CONTEXT.md`](../CONTEXT.md) §7

---

## Evidence review — 2026-10-17

The accepted migration policy below is preserved. These qualifications describe the
current code and open gaps, not newly approved policy. Historical references remain
historical, as explained in the [ADR index](README.md#historical-references-and-current-scope).

- **Historical sources are absent.** `docs/saas/TENANCY.md`, `docs/legacy/LEGACY-MAP.md`,
  `docs/CONTEXT.md` and `docs/legacy/API-INVENTORY.md` are not in this checkout
  (confirmed in the ADR index). The links in Related are historical citations only;
  nothing here validates or invalidates the migration rule against the legacy source.

- **Schema supports the new-tenant rule.** `Tenant.id` is `String @id @default(cuid())`,
  so tenants created after cutover get a `cuid()` — matching ADR rule 2 ("Tenants
  created after the cutover get a generated id"). `cuid()` values are alphanumeric
  and never numeric, so a new tenant cannot collide with a legacy numeric id stored
  as a string.

- **Schema permits but does not enforce the migration rule.** `Tenant.id` is a plain
  String, so a legacy owner id could be written verbatim as a string during migration
  (ADR rule 1). But there is no migration code, importer, or seed path that sets a
  legacy id — `seedTenant()` in `apps/api/prisma/seed.ts` creates the tenant via
  `prisma.tenant.upsert` and lets `cuid()` generate the id. The ADR's Enforcement
  claims "a migration test that runs the importer twice over a fixture and asserts
  identical target ids"; no such test or importer exists in this checkout.

- **Tenant scoping is in place.** `User.tenantId` is a non-nullable `String` FK to
  `tenants.id`, and every domain model carries `tenantId` referencing `tenants.id` —
  the isolation boundary the ADR's migration rule depends on.

- **Owner relation matches the ADR's caveat.** `Tenant.ownerUserId` is `String? @unique`,
  FK to `users.id`, with the documented foreign-key cycle. The ADR warns "`Tenant.id`
  equals this id only for tenants migrated from the legacy database, and nothing may
  rely on that" — the schema comment on `User.ownedTenant` repeats this caution.

No code change is implied by this review. The migration rule (migrated tenants keep
the legacy owner id) is not yet implemented in code; it awaits the migration/importer
work the ADR's Enforcement section describes.

## Context

The legacy system has no `tenants` table. The tenant _was_ the owner's row in
`users`: a row with `company_id IS NULL` and `isOwner IS NOT NULL`. Every other row
in the database points back at that row through `company_id = owner.id`, and the
code resolves the tenant on almost every query with the idiom
`company_id ?? user.id`.

The rebuild makes that structure explicit: a real `Tenant` model, a non-null
`tenantId` on every domain table, and a `tenantId` claim that the auth middleware
resolves once from the token. The remaining question is what value the `id` of a
migrated tenant should have, because thousands of rows already reference the
legacy value.

## Decision

**When a legacy database is migrated, `Tenant.id` is set to the owner's existing
`users.id`, verbatim.**

Companion rule, same rationale and same migration pass: **primary keys of other
migrated rows are preserved as well** — in particular `User.id` (the owner's and
every staff member's) — because `sales.sold_by_one…four`,
`employee_comissions.user_id`, `employee_leaves.user_id` and the department joins
all reference them.

Consequences that follow from the decision and are part of it:

1. A legacy id is numeric and is copied as a **string** (`"412"`, not `412`), so
   `Tenant.id` stays a plain `String @id`.
2. Tenants created _after_ the cutover get a generated id (`cuid()`, the default
   used by every model in `schema.prisma`). `cuid()` values are alphanumeric and
   never numeric, so a new tenant can never collide with a not-yet-migrated legacy
   id.
3. The migration is idempotent and restartable: re-running it over the same source
   produces the same target ids, so a failed run does not leave half a database
   pointing at ids that no longer exist.

## Why not the alternatives

| Alternative                                                                          | Why it was rejected                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generate a new UUID for every tenant and keep a `legacy_id → tenant_id` lookup table | Every `company_id` in the source has to be rewritten in a second pass. A run that dies half-way leaves rows pointing at ids that exist in no table, and the failure is silent: the FK either was not enforced (legacy `company_id` had no constraint at all) or the row migrates with the wrong tenant. Nothing in the new schema can detect it afterwards. |
| Keep the mapping table permanently and translate on read                             | A join on every query, forever, in exchange for an opaque id nobody asked for. It also hides the failure mode above instead of removing it: a missing mapping row becomes an empty result set rather than an error.                                                                                                                                         |
| Derive the id from something natural (`slug`, owner email, `company_name`)           | All three are mutable — a salon renames itself and its primary key changes. It also forces uniqueness decisions (two salons named "Beauty Corner") that the legacy data cannot answer.                                                                                                                                                                      |
| Give migrated tenants fresh ids but keep the legacy ids only in an audit column      | Solves nothing the mapping-table option did not already solve; the references still have to be rewritten.                                                                                                                                                                                                                                                   |

## Consequences

**Positive**

- The domain migrates with **zero remapping**: every legacy `company_id` is
  already a valid `tenantId`, so the copy is a straight `INSERT … SELECT`. This is
  the property that makes the whole cutover a one-pass job.
- Tenant-scoping bugs are loud. `company_id` was nullable and unconstrained, so a
  wrong value silently returned nothing or another salon's rows; after the
  migration the same value is a real foreign key, and a wrong one fails the insert.
- Support and operations stay cheap: "which salon is id 412?" is answered by the
  same number in the legacy system, the new database, the logs and whatever the
  operator has on paper.
- The shipped mobile client (whose API surface is frozen, see
  [`../legacy/API-INVENTORY.md`](../legacy/API-INVENTORY.md)) keeps returning the
  ids it already returns. No client release is coupled to the cutover.

**Negative / accepted costs**

- `Tenant.id` is not opaque; it reveals how old a tenant is and where it sits in the
  legacy numbering. Accepted: tenant ids are already visible in URLs to their own
  users, and nothing in the threat model depends on an unguessable tenant id —
  authorisation is decided by the token's `tenantId`, not by the id's shape.
- The rule "a migrated tenant keeps a numeric id, a new tenant gets a `cuid()`"
  must be written down. It is, here.
- If a _second_ legacy instance is ever migrated into the same database, its owner
  ids have to be checked against existing `tenants.id` values before importing.
  Documented as a migration precondition rather than solved in advance.

**Neutral**

- `platform_admins` ids are not preserved by this decision; nothing outside the
  legacy database references them, so the console may generate its own.
- `Tenant.ownerUserId` points at the owner's `User.id`, which — because of the
  companion rule — happens to equal `Tenant.id`. That is a coincidence of the
  migration, not a constraint: nothing in the schema or in application code may
  assume `tenant.id === owner.id`.

## Enforcement

- `tenants.id` carries a primary-key (therefore unique) constraint; the migration
  asserts uniqueness of its source rows before copying.
- The two rules in "Decision" are checked by a migration test that runs the
  importer twice over a fixture and asserts identical target ids.
- Template: [`README.md`](README.md).
