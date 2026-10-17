# 0003 — Customer email is unique per tenant, not globally

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Product (uniqueness scope) · Engineering (normalisation rules)
- **Related:** [`legacy/reference/legacy-schema.md`](../legacy/reference/legacy-schema.md)
  §customers, [`legacy/LEGACY-MAP.md`](../legacy/LEGACY-MAP.md) §5 finding 4,
  [`saas/TENANCY.md`](../saas/TENANCY.md) §1, [`roadmap.md`](../roadmap.md) Phase 2,
  [`STATE.md`](../STATE.md) §4.1 Q3

## Context

The legacy `customers` table declares `email` **`unique()`** — globally, across every
salon in the database
([`legacy-schema.md`](../legacy/reference/legacy-schema.md), §customers). The table's own
note states the consequence: "`email` is globally unique, so the same person cannot be a
customer at two salons."

That constraint was tolerable when the product was one installation per salon. It is not
tolerable now: one deployment serves many salons, isolated from each other
([`TENANCY.md`](../saas/TENANCY.md) §1). A global unique means the same person can never be
a customer of two salons, and — worse — it makes every other tenant an **existence
oracle**: creating a customer with an email that another salon already holds fails, and
the failure itself discloses that the address is a customer somewhere else.

The intent was already recorded in both legacy documents, so this ADR confirms rather than
discovers it: `LEGACY-MAP.md` maps `customers` → `Customer` with the note "Email
uniqueness becomes per-tenant", and `legacy-schema.md` closes its `customers` section with
"The rebuild scopes customer email uniqueness to the tenant."

It stayed open because it is a **Phase 2 schema commitment**, and because the mechanics
(`Customer.email` is nullable in the legacy table, and `unique()` applies to the empty
string exactly as it does to any other value) had not been settled.

## Decision

1. `Customer` carries `@@unique([tenantId, email])`. There is **no** global unique on
   `email`.
2. Email is stored **trimmed and lowercased**. Uniqueness is therefore case-insensitive
   through normalisation rather than through a `citext` column type, and the typed casing
   is deliberately not preserved.
3. A blank or whitespace-only value is stored as `NULL`, never as `''`. Postgres treats
   `NULL`s as distinct from one another, so a tenant may hold any number of customers with
   no email. Stored as `''` a tenant could hold exactly **one**, and the second create
   would fail with a constraint violation the user cannot see or fix — the empty string is
   "no email", not an email.
4. The same email held by two tenants is two different customers. That is the point of the
   decision, not a tolerated side effect.
5. Migration direction is safe and needs no cleanup pass: the legacy rule is **stricter**
   than the target, so every existing row already satisfies `(tenantId, email)`.
6. `Customer.email` stays nullable, in line with the legacy column (`email` **N**), so
   `NULL` is the single representation of "no email".

## Why not the alternatives

| Alternative                                             | Why it was rejected                                                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the legacy global unique                           | Re-opens the cross-tenant leak above, makes two salons unable to share a customer, and contradicts the tenancy model in [`TENANCY.md`](../saas/TENANCY.md) §1                            |
| `@@unique([tenantId, email])`, matched case-sensitively | `Ada@example.com` and `ada@example.com` become two customers of one salon, which no salon intends, and the duplicate surfaces only in reporting — long after the fact                    |
| A `citext` column for the same effect                   | Buys case-insensitivity at the cost of an extension the migration must install and a column type Prisma maps awkwardly; storing lowercase keeps the invariant visible in the data itself |
| No uniqueness in the database at all                    | Customer lookup and booking by email would then need de-duplication logic in every code path that touches a customer                                                                     |
| `@@unique([tenantId, email])` with `''` stored as-is    | The empty string is a value: one blank-email customer per tenant, and the next one fails for a reason that is invisible in the UI and unfixable by the user                              |
| Trim the email but keep the typed casing                | Preserves cosmetics nobody asked for while moving the case-insensitivity into application code that the database cannot enforce                                                          |

## Consequences

- **Positive.** One person can be a customer of several salons. No query can use customer
  creation as a cross-tenant probe. The invariant is enforced by the database, so a future
  code path cannot forget it.
- **Negative / accepted.** The typed casing is lost — if a later requirement needs it, the
  original string has to be stored in a separate column, which is a new decision. The
  normalisation rule is an obligation on **every** writer (API, importer, seed, admin
  tooling): a writer that skips it can still create `Ada@example.com` beside
  `ada@example.com`, and the database will not notice. `NULL` means three different things
  to a reader — "never provided", "blank", "cleared" — and the model does not distinguish
  them.
- **Neutral.** `Customer.email` remains nullable, exactly as in the legacy table. Legacy
  rows whose email is `''` (permitted once, globally, by the legacy constraint) import
  cleanly as `NULL`.

## Evidence review — 2026-10-17

The accepted per-tenant email uniqueness policy below is preserved. These qualifications describe
the current code and open gaps, not newly approved policy. Historical references remain historical,
as explained in the [ADR index](README.md#historical-references-and-current-scope).

- **Database constraint implemented.** `Customer` carries `@@unique([tenantId, email])` with no
  global unique on `email` — ADR rule 1 ✓. `email` is `String?` (nullable) — ADR rule 6 ✓. Postgres
  treats NULLs as distinct, so a tenant may hold any number of customers with no email — ADR rule 3's
  NULL behavior matches.

- **Email normalisation not implemented.** ADR rule 2 requires email to be "stored trimmed and
  lowercased" so uniqueness is case-insensitive. Neither `createCustomerSchema`
  (`z.email().max(255).optional()`) nor `updateCustomerSchema`
  (`z.email().max(255).nullable().optional()`) applies `.trim()` or `.toLowerCase()`. The customer
  service writes `row.email` straight through without normalisation. `Ada@example.com` and
  `ada@example.com` would be stored as distinct values and treated as distinct by the case-sensitive
  `@@unique` constraint — a direct conflict with rule 2.

- **Blank email handling differs.** ADR rule 3 says a blank or whitespace-only value is stored as
  `NULL`. Currently `z.email()` rejects `''` and whitespace-only as invalid email formats at
  validation, so they never reach the column as empty strings — they are rejected as validation
  errors instead of being normalised to `NULL`. The outcome (no empty-string email stored) is
  compatible, but the path is rejection-not-nulling.

- **Historical sources absent.** `legacy/reference/legacy-schema.md`, `legacy/LEGACY-MAP.md`,
  `saas/TENANCY.md` and `roadmap.md` are not in this checkout — historical citations only.

- **Tenant scoping is in place.** The Prisma client extension applies `tenantId` from the verified
  JWT; `createCustomer` uses `tenantId: ""` placeholder overwritten by `scopeCreateData`. No code
  path lets a caller name another tenant's customer.

No code change is implied by this review. The normalisation gap (trim + lowercase before storage) is
a real divergence from ADR 0003 rule 2 and should be addressed before the per-tenant uniqueness
invariant can be trusted case-insensitively.

## Enforcement

- The `@@unique([tenantId, email])` constraint itself, added by Phase 2's migration. Until
  that migration lands, **nothing enforces this** — there is no `Customer` model in
  [`../../apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma) today.
- The email validator in `@glampro_suite/shared` rejects `''` and whitespace-only before the
  value reaches the column, so rule 3 fails as a validation error rather than as a
  constraint violation.
- The Phase 2 migration must be a committed SQL migration like every other
  (committed SQL migration discipline).
