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
| `/platform`               | `CompaniesPage`     | Directory totals, searchable directory, plan end dates |
| `/platform/companies/new` | `CreateCompanyPage` | Create a company and invite its owner                  |
| `/platform/companies/:id` | `CompanyDetailPage` | Overview, subscription, module access, activity, purge |
| `/platform/account`       | `Account`           | The operator's own password and second factor          |

`PlatformApp.tsx` holds the route table and the session, restored from the tab on load;
`PlatformShell.tsx` draws the top bar with the two sections. Nothing renders before an
operator is known: an unauthenticated address is redirected to `/platform/login`, and an
unknown path under `/platform` falls back to the directory instead of a blank screen.
Account & security is its own page so an operator changing their password is never
standing next to a company's delete button.

## Directory totals and plan end dates

The directory opens with four tiles — **All companies**, **Active**, **Suspended** and
**Ending in 30 days** — computed by `listCompanies` in the same transaction as the page,
so a company created mid-request cannot appear in a tile but not in a page. They count the
whole directory and never narrow with the search box, which is why the first tile says
"All companies" while the card title above the table reports the filtered count. Only two
totals are single-status counts; `total` is a `groupBy` over every status, and
`expiringSoon` counts live companies whose **latest** plan ends within 30 days. A company
already past its last end date has lapsed rather than is expiring, so it is not counted
there — `resolveTenantStatus` is what turns that into `EXPIRED`.

Each row and the company page show **Subscription ends**, the latest
`Subscription.endDate` (`null` = no plan recorded, shown as "No plan recorded"). That is
the same column every other reader of a plan uses, so the console, the salon's Settings
page account details and the server's own expiry check cannot disagree.

## Placeholders and hints

A placeholder speaks in one of two voices:

- **An example of a valid value** — `glampro-demo-salon`, taken from the slug's
  `[a-z0-9]+(-[a-z0-9]+)*` shape, which no label can convey.
- **An instruction** — what to type, for a secret or a confirmation:
  - `Please enter your password`
  - `Please enter your new password again`
  - `Please enter the code from your email`

  This is the voice for a secret and for a confirmation: a masked field paints its
  placeholder as the only unmasked text it will ever show, so a sample password, PIN or
  code must never sit there, and a second password box has to say which box it is.

Neither voice may state a rule, and neither may stand in for the label. The placeholder is
gone after one keystroke, so anything that has to stay on screen — a length, a format, an
expiry — belongs in the field's `hint`, which `components/ui/Field.tsx` wires to
`aria-describedby`; and the label keeps naming the control, which
`apps/web/src/components/ui/__tests__/Input.test.tsx` holds `Input` to.

The one dynamic placeholder in the console is intentional: _Type the slug to confirm_
shows the real slug, and because it is a placeholder rather than a value the delete button
stays disabled until it is typed.

The salon app in `apps/web/src` follows the same convention, not only this console.
Examples carry the shape — `0.00` for money, `e.g. 10` for a percentage, `name@example.com`
for an address, `Search by name or phone…` for a lookup, `e.g. CUS-0104` for a reference,
`e.g. …` for a reason. Instructions carry secrets and confirmations — "Please enter your
current password", "Please enter your new password again", "Please enter the staff
member's PIN". Date, time, month and file inputs carry neither: the native control already
shows the expected form.

One trap when auditing: a masked field with a reveal button writes its type as an
expression — `type={showPassword ? "text" : "password"}` — so a sweep for `type="password"`
silently skips it, and the sign-in boxes in `pages/Login.tsx` and `platform/PlatformLogin.tsx`
are hand-composed `Field` + `CONTROL_CLASS` for exactly that reason. Find secrets by
`autoComplete` (`current-password`, `new-password`, `one-time-code`) or by scanning every
`<input` tag, never by the literal type.

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

## Sessions across a reload

An operator session survives a reload of the tab and nothing more
(`apps/web/src/platform/api.ts`):

- **Only the refresh token is kept**, in `sessionStorage` under
  `glampro.platform.refresh`. No access token and no profile are written — every
  request rotates the session, so a stored access token would be stale the moment it
  was saved, and a reload re-reads the operator from the server instead of trusting a
  copy. The salon's `localStorage` never holds operator credentials.
- **Tab-scoped, not machine-scoped.** Closing the tab ends the session, a new tab
  starts signed out, and nothing is left on a shared machine's disk for the next
  person. A duplicated tab copies the token: the two then share one session, so
  whichever rotates first signs the other out — the trade for not writing to disk.
- **`restore()` trades the token on the first render.** `PlatformApp` renders
  "Restoring your session…" while that exchange is in flight, then draws the route the
  URL asked for, so a reload of `/platform/companies/:id` lands back on that company
  rather than the directory or a password prompt. Concurrent callers share one
  exchange, because `/refresh` rotates the row in place and a second spend of the same
  token would be refused.
- **A refusal is final; an outage is not.** `401` (revoked, expired,
  password changed, operator disabled) drops the entry and the sign-in page says why.
  A request that never reached the server keeps it, so being offline does not cost the
  operator a second factor — the next reload tries again.
- **Sign-out revokes and forgets.** `POST /api/platform/auth/logout` runs first; only
  once the server has revoked the session is the entry removed, so a failed logout
  leaves both copies in place for a retry rather than a live session nobody can end.

The rest of the server-side rules are unchanged: the access token lives 15 minutes, the
refresh token 30 days, `tokenVersion` and `status` are re-checked on every use, and
signing out revokes the session immediately. The header has no "check session" button —
the profile request it triggered gated nothing, and every real request already validates
and rotates the session.

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

## Editing a company and its owner

`PATCH /api/platform/companies/:id` with `{ name, slug, reason }` — plus an optional
`{ ownerName, ownerEmail }` pair — corrects a company that already exists. The
overview card's **Edit company** button opens it, and so does the line under the
owner facts: "No owner is recorded … _Assign an owner_".

That line is the point of the endpoint. The console could create a company but never
_change_ one, so a company whose `ownerUserId` was never written read "No owner
assigned" on three rows with no action anywhere that could fill it in — the only way
out was to delete the company and start again.

- **The owner pair travels together.** `updateCompanySchema` refuses one without the
  other, and sending neither is how the operator says "keep the owner". The form
  sends the pair only when it actually differs from what the server reported, because
  an untouched pair would ask the server to re-open an owner branch it refuses.
- **A pending owner can be corrected; a working one cannot.** Assigning an owner
  creates the pending account exactly as creation does: an unknown random password
  hash, the account disabled, and a 48-hour invitation. Editing a _pending_ owner
  updates the name and address and issues a fresh invitation when the address
  changes. An owner who has **accepted** answers `409` — replacing them demotes
  somebody who can sign in today, which is an ownership _transfer_, not a rename. The
  two fields are disabled in that case so it cannot be attempted by accident.
- **Only an active company can be given an owner.** `acceptOwnerInvitation` refuses a
  suspended or cancelled company, so an invitation issued there would mint a link
  that cannot work; the API says "Reactivate this company before changing its owner."
- **A saved edit is never lost to a mail server.** `createCompany` refuses up front
  with `503` when SMTP or the portal origin is missing, because nothing has been
  written yet. An edit is written in a transaction that locks the tenant row
  `FOR UPDATE`, and the invitation goes out afterwards: if delivery fails the answer
  is `invitationDelivery: "failed"` and the console points at **Resend invitation** —
  a real retry rather than a second save. `null` means no invitation was needed.
- **Two audit rows.** `company.update` records the before/after identity and the
  reason; `company.owner.assign` (or `company.owner.update`) records the ownership
  change on its own, because "renamed" and "given to somebody else" are different
  events to read back later.

## Company access and the lifecycle buttons

The Company access card is a status badge, three buttons and one sentence:

- **The badge is the effective status** — the stored column _and_ the periods, the same
  answer `GET /administration` returns as `effectiveStatus`. A company whose stored
  status is `ACTIVE` but whose last period has ended reads **Expired**.
- **A button that cannot work is dimmed, and the sentence says why.** Suspend,
  Reactivate and Cancel used to be live whatever the state, so two of the three always
  answered `409`. Each is now gated on a rule `changeCompanyLifecycle` already enforces
  (`apps/web/src/platform/tenantStatus.ts` holds all three):

  | Button     | Offered when                                                          | Why the API refuses otherwise                                                                                                                          |
  | ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Suspend    | `effectiveStatus === "ACTIVE"`                                        | Only an `ACTIVE` company can be suspended — suspending something already closed says nothing.                                                          |
  | Reactivate | stored status is not `ACTIVE` **and** the latest period has not ended | "The company already has that status"; or the latest period that started has ended — "Record a current subscription before reactivating this company." |
  | Cancel     | stored status is not `CANCELLED`                                      | A cancelled company cannot be cancelled again.                                                                                                         |

- **"No period at all" is not the same as "no period running".** A company provisioned
  before its first plan has no rows on the Subscription tab, and `changeCompanyLifecycle`
  lets that reactivation through (its query finds nothing to refuse). So the button is
  offered, and the sentence says access still needs a period — dimming it here would be
  a dimmed button the API would have accepted, which is the bug the gating exists to
  fix. Only a period that _started and ended_ is a refusal, which also means a scheduled
  `PENDING` period neither runs nor counts as the ended row the API refuses on.

- **The reason is text, not a tooltip.** A disabled button takes no hover and no focus,
  so the explanation sits in the sentence beside the badge. It also names the way out —
  "record a new period on the Subscription tab, or cancel the company" — because a
  dimmed button with no next step is a dead end with a colour.
- **Both statuses are reported.** `companyAdministrationSchema` returns `status` (the
  column) beside `effectiveStatus`: the badge shows the second and two of the three
  rules read the first, so the console cannot decide them from one value.
- **Suspension is not "expired".** A stored-`ACTIVE` company whose period lapsed reads
  `EXPIRED` and its Reactivate button is dimmed, because the record still says `ACTIVE`.
  The way forward is a new period — which brings access back on its own, without a
  lifecycle change — or a cancellation.

## Recording a subscription period

The Subscription tab is **one card, one modal and one disclosure**:

- **Plan** — the status badge, the count of recorded periods, when access starts and
  ends, how long is left and the amount. Nothing here writes.
- **Record period** — a button in that card's header opens the form in a modal. Only
  this writes: `POST /api/platform/companies/:id/subscriptions`. Nothing is charged
  or captured; the record is what gives the company a dated period of access.
- **Subscription history** — a `<details>` disclosure holding the period table, with
  the count in its summary so a closed disclosure still answers "is there any
  history?".

The tab used to be three stacked cards under a lifecycle card, and it borrowed that
card's single "Change reason" input — so a renewal read as if its reason belonged to
suspending the company. The reason now lives inside the form that needs it, the form
is opened when an operator wants it, and the 100-row table no longer pushes the one
card that matters off the screen.

- **The operator picks days, the API stores instants.** `recordSubscriptionSchema`
  requires an offset (`2026-10-23T00:00:00+08:00`) because a bare `2026-10-23` is a
  different moment in every timezone. Both fields are `<input type="date">`, which knows
  only the day, so `dayToLocalInstant` (`lib/utils.ts`) writes that day's midnight in the
  operator's own timezone with the offset attached — the day the operator picked is the
  day that is recorded, never the one before it.
- **Neither field carries a placeholder.** Per _Placeholders and hints_, the native
  control already shows the expected form; the rules that have to stay on screen (both
  boundaries are midnight, periods cannot overlap) sit in the hint under each field.
- **A period may start on any day.** Scheduling the next period is what an operator does
  on renewal, so a start in the future is a normal request: `recordCompanySubscription`
  refuses only an end that has already passed (_Choose a period end in the future._),
  because a period that is over cannot extend anyone's access. The start picker
  therefore carries no `max`.
- **The end's earliest day follows the start.** Its `min` is the later of tomorrow — an
  end of "today" is already in the past once it is stored at midnight — and the day
  after the picked start, so the pair cannot be inverted before the request leaves the
  browser. `recordSubscriptionSchema` rejects an inverted pair too (_The end must be
  after the start._), because a request need not come from this form.
- **A scheduled period brings no access forward.** `resolveTenantStatus` counts only
  periods whose first day has arrived, and reactivating still requires a _current_
  period, so recording next month's period does not lift an `EXPIRED` company back to
  `ACTIVE` today. The summary says so where the operator meets it — "No period is
  running now. The next one starts 1 Dec 2026, in 30 days — a period brings no access
  forward until its first day" — instead of leaving the status badge's silence to be
  interpreted.
- **Overlap and rejection.** A period that overlaps an active one answers `409`, and a
  rejected period keeps its typed days so the operator corrects one field rather than
  retyping the form. A rejection is reported inside the card that caused it, and the
  change banner above belongs to lifecycle and module changes only.
- **The history renders days, not instants.** A row reads `23 Oct 2026 → 22 Nov 2026`
  with the amount formatted in its own currency, a `Current` badge on the period that is
  running and a `Scheduled` badge on one that has not started. The raw
  `2026-10-23T00:00:00+08:00` belongs to the API and the audit payload, not to a table an
  operator reads at a glance.

## Module access

The Module access tab of a company is a row per module with a switch: on means
`entitled`, off means not. Core modules are always on and their switch is disabled,
so the difference between "always available" and "granted" is structural rather than
something to remember.

- **A lapsed grant reads as off.** The server reports `enabled: true, entitled: false`
  once an `expiresAt` has passed; the row shows an `Expired <date>` badge and explains
  what turning it back on does, instead of quietly showing "not granted".
- **Every change needs a reason.** `companyModuleSchema` requires one, so the switch
  opens a confirmation with the reason field (and, when granting, an optional
  expiry). Revoking never sends an expiry — the schema rejects one.
- **An expiry is a day, not a typed instant.** It used to be a free-text ISO field
  (`2026-11-23T00:00:00+08:00`) that only a developer could fill in twice the same
  way. It is now a `<input type="date">` whose `min` is tomorrow — an expiry of
  "today" is already past once it is stored at midnight — with 30-day, 90-day and
  1-year presets and an explicit **No expiry**. `dayToLocalInstant` attaches the
  operator's own offset, so the grant ends at midnight on the day they picked.
- **A module with nothing behind it says so.** `UNENFORCED_MODULE_CODES`
  (`memberships`, `inventory`, `expenses`, `stock`, `employeeCommission`) have no
  `requireModule` guard and no screen, so granting one changes nothing a salon can
  see. Their switch is disabled and the row reads "Not in this release".
- **Every add-on at once, for one decision.** **Turn all on** and **Turn all off** sit in
  the card header and call `POST /:id/modules/bulk` with `{ enabled, expiresAt, reason }`
  (`companyModulesBulkSchema`). The body names no modules: which ones may be granted is
  platform data, so the server decides — core modules and `UNENFORCED_MODULE_CODES` are
  never touched, and a `codes` field in the body is a `422`, not a widened set.
- **A bulk grant does not rewrite a running one.** Only add-ons that are off or lapsed
  are granted; one that is already entitled keeps its own expiry, because stamping a new
  term over a year-long grant would silently shorten it. Those codes come back in
  `unchanged`, and the banner reports both counts — "3 add-ons turned on. 2 were already
  on and left alone." — rather than a total that is not true.
- **A bulk revoke clears lapsed grants too.** Left behind, a lapsed row would keep the
  table showing "Expired" while its switch read off.
- **One audit row per click**, not one per module: `company.module.bulk_grant` /
  `.bulk_revoke` with `{ reason, codes, unchanged, after }` in the metadata. A batch that
  would change nothing answers `409` instead of writing an empty row, and both buttons are
  dimmed when there is nothing to do — the count above the table ("0 of 2 add-ons on, 1
  lapsed") says so before the click.
- **The switch never moves optimistically.** It keeps the server's position while the
  request is in flight, and a rejected change leaves it where it was with the reason
  still typed in the open dialog.
- **A revocation reaches the open tab.** The browser reads a salon's entitlements once
  per session (`GET /auth/me`) and filters the rail on them, so an add-on revoked
  while a tab is open keeps its rail entry. A `403 MODULE_NOT_ENTITLED` now raises
  `ENTITLEMENTS_STALE_EVENT` (`lib/api.ts`), which `AuthContext` answers by re-reading
  the profile once for the whole burst; the entry then leaves the rail. `requireModule`
  was already the boundary — this only stops the rail from disagreeing with it.

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
