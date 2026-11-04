# Platform console

The operator console at `/platform` manages companies, their subscriptions and
their add-on access. It is not a salon surface: an operator session has no tenant
and can read across every company, so everything here is audited and nothing here
is reachable from a salon login.

Code: `apps/web/src/platform/*` (UI), `apps/api/src/services/platform-auth.service.ts`
(sign-in and account), `apps/api/src/services/company-purge.service.ts` (removal),
`apps/api/src/routes/platform-auth.routes.ts` and `companies.routes.ts` (routes).

## Screens and routes

The console is built from the shared design system (`apps/web/src/components/ui`) and
has real routes; it used to be one screen that redirected to itself whenever the
address bar disagreed with it.

| Route                     | Screen              | What it does                                           |
| ------------------------- | ------------------- | ------------------------------------------------------ |
| `/platform/login`         | `PlatformLogin`     | Operator sign-in and the emailed-code step             |
| `/platform`               | `CompaniesPage`     | Searchable directory, status and pagination            |
| `/platform/companies/new` | `CreateCompanyPage` | Create a company and invite its owner                  |
| `/platform/companies/:id` | `CompanyDetailPage` | Overview, subscription, module access, activity, purge |
| `/platform/account`       | `Account`           | The operator's own password and second factor          |

`PlatformApp.tsx` holds the route table and the in-memory session; `PlatformShell.tsx`
draws the top bar with the two sections. Nothing renders before an operator is known:
an unauthenticated address is redirected to `/platform/login`, and an unknown path
under `/platform` falls back to the directory instead of a blank screen. Account &
security is its own page so an operator changing their password is never standing next
to a company's delete button.

## Sign-in

1. `POST /api/platform/auth/login` with the operator email and password.
2. If **email verification is on** (the default), the response is
   `{ requiresTwoFactor: true, challenge }` and a six-digit code is emailed. The code
   is never returned in the response and never written to logs;
   `apps/api/src/services/platform-auth-delivery.test.ts` fails if either changes.
   `POST /api/platform/auth/verify` exchanges the challenge and code for a session.
3. If **email verification is off**, the response is the session itself and the
   operator lands in the console after the password check.

Without SMTP configured, a login for an operator who still has verification on is
refused with `503 EMAIL_NOT_CONFIGURED` — there is no fallback that would quietly
accept a password alone. The recovery for a locked-out operator is an operator-side
action, not a console one: `npm run platform:bootstrap` (or a direct
`platform_admins."twoFactorEnabled" = false` update), then re-enrol from
_Account & security_.

Sessions live in memory only; a page reload signs the operator out. The header has
no "check session" button any more — the profile request it triggered gated nothing,
and every real request already validates and rotates the session server-side.

## Account & security

The page at `/platform/account`: identity, password and the second factor, in three
cards. `POST /api/platform/auth/password`, `…/two-factor/enroll`, `…/two-factor/confirm`,
`…/two-factor/disable`. All four require a valid operator session.

- **Password change** takes the current password plus a new one that meets
  `adminPasswordSchema` (12+ characters, no known demo passwords). The new hash and
  the revocation of the operator's _other_ sessions are one transaction, so a leaked
  refresh token cannot outlive the password it was minted under. The session that
  performed the change survives, and the console reports how many others were
  signed out. The three rules the schema enforces are shown as a checklist while
  typing, rather than stated once in prose.
- **Turning verification on** is two steps: `enroll` emails a code and `confirm`
  consumes it. The switch flips only on confirmation, so a failed send, a broken
  mail server or a typo cannot lock the console out of its own sign-in. The switch
  shows `twoFactorEnabled` as the server reported it and never moves optimistically;
  the code is requested when the confirmation opens and a failed send is reported
  inside it.
- **Turning verification off** opens a confirmation that re-proves the password,
  because it weakens sign-in for that operator. Every one of these actions writes an
  `audit_logs` row (`platform.password.change`, `platform.two_factor.enable`,
  `platform.two_factor.disable`).

## Module access

The Module access tab of a company is a row per module with a switch: on means
`entitled`, off means not. Core modules are always on and their switch is disabled,
so the difference between "always available" and "granted" is structural rather than
something to remember.

- **A lapsed grant reads as off.** The server reports `enabled: true, entitled: false`
  once an `expiresAt` has passed; the row shows an `Expired <date>` badge and explains
  what turning it back on does, instead of quietly showing "not granted".
- **Every change needs a reason.** `companyModuleSchema` requires one, so the switch
  opens a confirmation with the reason field (and, when granting, an optional ISO
  expiry). Revoking never sends an expiry — the schema rejects one.
- **The switch never moves optimistically.** It keeps the server's position while the
  request is in flight, and a rejected change leaves it where it was with the reason
  still typed in the open dialog.

## Deleting a company

`DELETE /api/platform/companies/:id` with `{ confirmSlug, reason }` removes one
company and every row filed under it. This is deliberately not a fourth lifecycle
action: suspend, reactivate and cancel keep the data and stay reversible; a purge
does not, so it has its own verb, its own schema (`companyPurgeSchema`) and its own
danger-zone card in the company overview.

- **The modal is the confirmation.** The card holds one button, which opens a
  confirmation asking for a reason and for the slug typed back; the delete button
  stays disabled until both are right. It used to be a `<details>` disclosure with the
  form already open inside it, which looked like a setting rather than a last resort.
- **A mismatch is `409 COMPANY_CONFIRMATION_MISMATCH`** and nothing is touched. The
  reason is required and lands in the audit row. A rejection keeps the dialog open with
  the reason still typed, so the operator corrects one field instead of retyping both.
- **Success leaves the company page** and returns to the directory with the row count
  the server reported, so "deleted" is never claimed before it happened.
- **One transaction.** The service locks the `tenants` row `FOR UPDATE` (the same
  lock the lifecycle writer takes), deletes children in dependency order, deletes the
  tenant and writes the audit row — or the whole purge rolls back and the company is
  exactly as it was. The interactive transaction timeout is raised to 120 s.
- **What goes.** All 81 tenant-scoped tables in `TENANT_PURGE_ORDER`
  (`company-purge.service.ts`): customers, appointments, catalogue, POS sales and
  tenders, packages and prepaid ledgers, commission and payroll history,
  subscriptions and recorded payments, invitations, messaging state, consent and
  treatment records. That is the whole company, not a summary of it — payroll and
  billing history are _not_ retained, which is why the confirmation is this strict.
- **What stays.** `audit_logs` is a _reference_ table (`TENANT_REFERENCE_MODELS`),
  not a scoped one. The purge row is written after the tenant is gone, with
  `tenantId` null and the company's id, name, slug, reason and deleted row count in
  `metadata`, so the destruction itself stays attributable. `refresh_tokens` go with
  their users by cascade; `tenants.ownerUserId` is nulled first because it references
  `users` with `ON DELETE RESTRICT`.

### Why a database break-glass exists

Eleven tenant foreign keys are `ON DELETE RESTRICT`, and twenty trigger functions
protect append-only evidence (commission, payroll, prepaid, package valuation,
treatment consent, POS line economics). Those guards raise on any `DELETE` unless the
parent tenant row is already gone — a state a purge can never be in while it is
deleting the tenant's own rows.

`20261105120100_platform_tenant_purge` replaces those function bodies with one added
escape at the top of each:

```sql
IF TG_OP = 'DELETE'
   AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
  RETURN OLD;
END IF;
```

`company-purge.service.ts` sets that setting with
`set_config('glampro.purge_tenant', $tenantId, true)`. The `true` makes it
**transaction-local**, so a pooled connection cannot carry it into a later salon
request, and the value has to equal the row's own tenant — the escape cannot reach
into another company. Every other `DELETE` still hits the guard that follows, with
its original message, so ordinary salon traffic sees no behaviour change.

The migration only replaces function bodies; triggers, tables and constraints are
untouched.

### Ordering and its invariants

`TENANT_PURGE_ORDER` is derived from the foreign keys: a table appears before every
table it points at. `apps/api/src/services/company-purge.test.ts` keeps it honest
without a database:

- it asserts the list equals every `TENANT_SCOPED_MODELS` table, so a new
  tenant-scoped model that nobody adds here fails the build rather than surviving a
  purge;
- it asserts no reference table is in the list, because deleting `audit_logs` would
  erase the evidence of the purge;
- it rejects duplicates, which would double-count rows in the reported total.

Adding a tenant-scoped model therefore means adding its table to the purge list in
dependency order.

## Limits

- A purge cannot be undone and there is no export step: take what you need first.
- It is an operator action on one company. It is not a records-retention schedule,
  not a customer-level erasure flow, and it keeps no copy of what it removed.
- `payroll_cutovers` and `payroll_cutover_events` are listed first because they
  reference nothing but `tenants`; their migration has to be applied for the purge to
  reach them.
