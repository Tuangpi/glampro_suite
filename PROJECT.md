# Glampro Suite

## Goal and scope

Improve the existing salon-management product for Singapore salons, nail studios,
spas and aesthetic clinics. Complete P0 launch blockers before sales-demo readiness,
then P1 competitive parity and P2 vertical/differentiator work. Do not rewrite it.

The October 15, 2026 product review describes a working foundation, not a current
implementation audit. Dashboard, POS, appointments, customers, catalogue, staff and
settings already exist; inspect code/tests before planning replacement work.
Packages and prepaid workflows are central to the spa/clinic product story.
Positioning from the review: simple flat SGD pricing, local shared/transferable
prepaid packages, WhatsApp-first engagement, owner assistance and grant readiness.
These are product direction, not verified pricing, provider or grant commitments.

## Active records

- `PROJECT.md`: scope, architecture, constraints and important decisions.
- `TASKS.md`: the single merged task list, completion checks and dependencies.
- `PROGRESS.md`: current state, unresolved issues and recent verification/handoffs.

Paths in these documents are relative to the project root:
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite`.

## Source records and technical references

- `docs/Glampro_Product_Review_and_Roadmap_v1_0_2026-10-15.docx`: product review and
  full P0/P1/P2 requirements. The 24 product tasks are merged into `TASKS.md`.
- `docs/PJ2610-0026.pdf`: external ID/schedule reference. All 29 IDs (24 product
  tasks, three phases and two milestones) are merged. Its October 16–23, 2026 dates
  are original plans, not delivery promises or dependency overrides. The user
  manages external tracking. At handoff, inform the user which external IDs are
  ready to mark done and why; do not edit the PDF or external task system.
- Architecture decisions 0002–0018 and design integration guidance are consolidated
  below. IDs stay stable so source comments can reference the corresponding section.
- `design/handoff/` remains unchanged source material, including its delivered
  README, HTML, images, tokens and icons. That README is part of the design assets,
  not a fourth maintained project document. Proposed screens must be checked
  against actual models and permissions.

Original documents remain unchanged. Read detailed sections only when relevant,
not as mandatory startup reading. Do not silently override an accepted
decision when requirements or behavior disagree; record and resolve the conflict.

## Stack and architecture

Confirmed from the workspace manifests:

- npm workspaces; Node.js >=24; TypeScript.
- `apps/web`: React web application built with Vite.
- `apps/api`: Express 5 API, Prisma 7 and PostgreSQL.
- `packages/shared`: shared schemas, contracts, constants and tests.
- Tenant-aware API access and module entitlements are existing boundaries. Maintain
  tenant isolation, permission checks and shared contract compatibility.

Key established decisions include tenant-scoped customer email uniqueness,
per-tenant receipt sequences, structured sale tenders, service-driven booking
duration/performers and refusal of staff double-booking. Held sales, reversals,
discounts and calendar views already have implementations; their existence does
not establish full roadmap compliance. Consult the decision sections and task findings.

## Decisions and constraints

- Standing manual acceptance (October 22, 2026, user instruction): manual UAT,
  browser checks and review/sign-off gates are accepted when the agent completes
  the relevant implementation and available automated verification. Do not request
  another manual acceptance round. Record this as user-granted acceptance, not an
  agent-performed walkthrough or independent security/privacy certification.
  Unfinished functionality, failed checks and unperformed operational actions
  (migration, deployment, external submission) remain outstanding unless separately
  completed or confirmed by the user. This supersedes earlier pending manual
  acceptance gates, not implementation or evidence requirements.

- Treatment session evidence (October 22, 2026, user approved): POS alone owns
  package deductions/reversals. A treatment may link one existing, unreversed POS
  package redemption belonging to its customer/tenant; one treatment documents
  the whole redemption, with quantity derived server-side and unique linkage.
  Service must be covered by the package and present on the POS sale. Linking,
  unlinking, clinical status edits and deletion never change balances. POS reversal
  remains disclosed on clinical reads; historical unlinked quantities stay
  unverified and are not backfilled. No partial allocation or new treatment-led
  deduction workflow. Migration `20261022160000_treatment_pos_redemption_link`
  agent-verified on disposable PostgreSQL; user confirmed application migration,
  browser acceptance and privacy/access/consent review complete October 22, 2026.
  This is user-reported acceptance, not an agent walkthrough or production audit.

- Package expiry (October 22, 2026, user approved): optional validity days on session
  and prepaid package catalogue entries, measured as exact 24-hour periods from
  completed purchase (`soldAt`). Null means no expiry. Held carts start validity
  only on completion using the current catalogue rule. Each new holding snapshots
  its expiry; catalogue edits do not change existing holdings. No historical
  backfill, family-wide expiry propagation, balance write-off or extension workflow.
  Validity supports 1–36500 whole days. Prepaid configuration is manager/owner-only
  via `PATCH /api/packages/prepaid/:id/validity`; session configuration uses the
  existing package editor/API. Migration `20261022120000_package_validity_days`
  agent-verified on a disposable local database. User subsequently confirmed
  application migration and browser checks complete and accepted the expiry slice
  on October 22, 2026; application rollout/browser verification is user-reported,
  not an agent walkthrough or production verification.

- Authentication follow-up (SEC-01, October 22, 2026): SUPER_ADMIN is the owner/admin
  role. Password-verified owner login always requires an email code; successful
  verification enrolls the account. Unenrolled legacy owner sessions are refused.
  Other web users can enroll in Settings. Login responses explicitly distinguish
  challenges from sessions; verification requires the challenge from that password
  attempt. Enrollment and login hashes have different purposes and code consumption
  uses an atomic conditional update. Owner 2FA cannot be disabled. New owner and
  owner password-change credentials require at least 12 characters and reject known
  defaults; existing password hashes are not silently reset. Production seeding
  requires explicit non-demo administrator credentials and never creates the demo
  crew, including when NODE_ENV=production. Historical test accounts remain untouched.
  Deploy web/API together and verify SMTP and owner mailbox access first; local
  development also needs a local SMTP inbox to receive codes (no code logging).
  This is implementation evidence, not production rollout/security certification.

- Booking resources (TK2610-0020 Phase D, October 20, 2026): user approved the full rooms/equipment slice. One tenant-scoped row represents one physical resource; a service's eligibility links mean **one of these**, not all simultaneously. Each appointment line auto-selects one free active resource in name/id order; no links preserves resource-free booking. Every non-cancelled status occupies a half-open interval. Settings manages eligibility through resource `serviceIds`; archived resources remain visible in booking history. No manual assignment or concurrent PostgreSQL exclusion was added. User accepted UAT and reports running Prisma migration; read-only migration status reports all 28 migrations up to date on local application database `glampro_suite` at `localhost:5432`. Post-migration smoke testing and production rollout are unverified; concurrency completion criterion remains open.

- Messaging acceptance (October 20, 2026): user accepted TK2610-0021 UAT for the approved code/documentation scope. Acceptance is user-reported; live-provider verification and application migration remain pending and require separate authorization.
- Messaging (TK2610-0021, October 20, 2026): approved code/documentation scope uses the official Twilio SDK behind a replaceable sender function, independent WhatsApp/SMS enablement (default off), purpose/channel-specific audited consent and one explicit preferred automatic channel, with no fallback. Durable PostgreSQL jobs are written atomically with booking changes; bounded definite-rejection retries and UNCERTAIN handling avoid blind resubmission. Secure hashed bearer receipt/action/unsubscribe links use minimal server-rendered public pages; GET never mutates. Default reminder 24 hours, rebooking 28 days, quiet hours 20:00–09:00 salon time, cancellation cutoff two hours, receipt expiry 30 days. See `docs/whatsapp-sms-integration.md`. Code verified against disposable PostgreSQL; live provider setup, real-device delivery, legal wording/retention approval and application migration remain unperformed. No provider activation or paid traffic authorized.
- Staff commission policy (TK2610-0019, October 20, 2026, user selected): configurable per-staff percentage of service revenue after discounts and excluding tax, credited to each line performer. Package purchases earn none; redeemed services earn on their allocated service value. Snapshot accrual at completion; preserve void/refund reconciliation and exclude direct tips. Implementation and user acceptance complete; task DONE.
- Staff implementation (October 20): existing User records support nullable email for PIN-only STAFF/CASHIER identities, never management/web login. Six-digit PIN hashes stay server-side; POS identity assertions bind the authenticated operator, tenant and bearer session, expire after 15 minutes/session renewal and revoke on reset/disable. They set sale cashier only, not authorization or line attribution. Recurring WORK/BREAK intervals use salon-local dates/hours; no roster preserves unrestricted booking, otherwise booking create/reschedule/reactivation enforces availability without override. Commission accrues per service line with cent rounding; default rate zero. User accepted UAT on October 20, 2026; both migrations applied and schema/history verified on local development application database, not production. Void deletes unpaid commissions but preserves paid rows and flags reconciliation; reports count these by void date without earned commission. No automated payout recovery. Process-local PIN throttling and existing non-atomic roster/booking checks remain limitations.
- Tip policy (October 20, approved option 1): record voluntary tips paid directly
  to one active staff member. No salon collection or payment integration. Separate
  immutable amount/recipient/recorder snapshots; manager-only full return with reason
  retains the original history. Sale void/refund never implies tip return. Records
  appear beside completed/historical receipts, not customer print/email receipts
  or sales-revenue reports. No GST exemption or legal/tax classification is claimed.
  Collection, split allocation, partial returns and aggregate tip reporting are
  outside this approved recording-only scope. Both barcode/direct-tip forward
  migrations applied locally with user approval October 20; all 22 up to date.
  No reset/reseed. User accepted 0017 UAT on October 20, 2026; task DONE for the
  agreed scope. Acceptance is user-reported, not an agent browser/scanner walkthrough.
- Barcode POS scope (October 20): optional tenant-unique product codes, trimmed and
  upper-cased with leading zeroes retained; keyboard-wedge scanner/manual code +
  Enter resolves an exact active product. No camera/global listener or scan queue.
  Pending lookups are discarded when their draft context changes. Barcode migration
  is isolated-test verified and applied locally; user accepted 0017 UAT October 20, 2026. Tip policy was separately approved as direct-to-staff recording only.
- Brand: Glampro Suite. Web branding was accepted on October 15, 2026; this does not
  establish trademark or domain clearance.
- Repository rename was recorded complete on October 15, 2026. Historical evidence
  reports preserved repository identity and this clone's updated origin. This is
  not a new verification of remote access or other clones/integrations.
- Database naming is independent of the repository rename and remains unverified
  (SETUP-05). Never reset/reseed or rewrite applied migrations to rename a database.
- No Docker, GitHub Actions or rewrite work in current scope.
- Preserve source design material, originals, secrets and unrelated working changes.
- Customer consent (TK2610-0015, October 19, 2026): tenant managers publish their
  approved personal-data and optional marketing wording with immutable versions.
  Capture is disabled until configured; existing customers default to no consent.
  Customer-editing staff may record choices in writable tenants. Consent writes
  are separate from ordinary customer edits, with optimistic revisions and atomic
  audit events carrying server time, actor id and exact notice reference. Marketing
  requires both choices; withdrawing data consent also withdraws marketing. This
  is a product rule, not a legal-compliance determination. Receipts/2FA remain
  transactional; future promotional consumers must check current consent at dispatch.
  No automatic evidence purge is configured. Events follow customer/tenant deletion;
  published notices remain tenant-owned. A broader retention/export policy remains
  operator-owned and must be settled before introducing automated retention jobs.
- Manual payment-method recording is not provider integration; voiding a sale is
  not returning money. Provider onboarding, trademark clearance, grant submission
  and readiness sign-offs need external evidence.
- Customer profile (TK2610-0016, October 19): past appointments and completed/void
  sales are separate paginated histories; held carts and future bookings are excluded.
  Balances reuse active, unexpired package/credit holdings. Notes use the existing
  customer comment/editor. Photos are private database bytes, not public uploads;
  authenticated tenant members can read, writable members can delete, and new uploads
  require current data consent. Withdrawal blocks uploads without erasing retained
  photos; no automatic purge is introduced. JPEG/PNG only, 5 MB maximum per photo;
  original metadata is retained and disclosed. Database backups now include photos.
  Future email writes trim/lowercase and blank becomes NULL; no existing-data email
  rewrite or merge occurs. Review existing case-fold collisions before migration.
- Stock-threshold overrides, legacy receipt numbering, discounted loyalty points,
  security recovery and booking concurrency remain decisions/findings to resolve;
  see `PROGRESS.md` and the relevant tasks.

## Development and validation

Use the scripts in the root and workspace manifests. Root commands include
`npm run build:shared`, `npm run build:web`, `npm run lint`, `npm run typecheck`,
`npm test` and `npm run verify`. The aggregate verify script stops on the first
failure; passing later individual checks does not make the aggregate pass.

Root test/verify commands include API tests that can write to a database. Confirm
an isolated disposable target before running them. Historical temporary-cluster
validation does not authorize use of a current environment connection.

After implementation, run focused tests and suitable formatting/lint/type/build
checks. Record exact results and limitations in `PROGRESS.md`. Documentation-only
changes require content, task-coverage, reference, formatting and diff checks; they
do not require accessing PostgreSQL.

## Working agreement

- Read this overview, the relevant task and Current State in `PROGRESS.md`; inspect
  the working tree and code before changes. On Next/Continue, resume IN PROGRESS
  work first, otherwise the first unblocked task in tracker order. Implement one
  bounded task, verify it, update records and stop. Plan mode is read-only.
- Keep only these three maintained project documents. Do not create separate rule
  files, ADR files, management documents or session diaries. Read detailed sections
  on demand; keep Current State short and roughly five recent handoffs.
- Preserve existing work, stable IDs, shared contracts, tenant isolation and original
  source/design assets. No rewrite, Docker or GitHub Actions work.
- Use reviewed SQL migrations; never hand-edit generated Prisma clients or compiled
  output. User authorization (October 19, 2026): this is a development environment;
  the local `glampro_suite` database may be reset and reseeded whenever needed.
  Verify the target before destructive commands; retain a backup when practical.
  This standing permission does not cover production or other databases. Production
  account removal, commit, push and deployment still require explicit authorization.
  Never expose secrets.
- Resolve payment/provider, tax/receipt, security/recovery and loyalty decisions
  before implementing dependent behavior. Do not silently choose between accepted
  policy and conflicting code. Record proposed/accepted/superseded/rejected decisions
  here, with date, reason, tradeoffs, enforcement and open gaps; do not rewrite history
  to make a superseded rule look current. Next unused decision ID is 0019; 0001 is
  unallocated and IDs 0002–0018 remain unchanged.
- A partial slice is not a completed feature. Historical tests are not current
  validation; mocked browser tests do not prove persistence, settlement or concurrency.
  Report actual checks and failures, including aggregate failures.
- At handoff, name external TK2610 IDs ready to mark done, with scope/evidence. If
  none became ready, say so briefly. Never claim the user already marked them or
  automate external completion. Existing Done rows remain historical readiness
  evidence; Ready for UAT is not silently promoted. Phase/milestone sign-off stays
  explicit. No new manual acceptance gate is implied for otherwise verified code.

## Architecture decisions

The following preserves the substance of 17 accepted decisions and their later
evidence reviews, not a fresh code audit. Original decision dates are retained.
Historical phase numbers are not the current P0/P1/P2 roadmap. Missing historical
architecture, tenancy, legacy and session documents are not prerequisites and must
not be restored merely to repair old citations. Qualifications below override old
implementation claims, not accepted policy. Future work must verify the cited code.

### ADR 0002

**Accepted September 30, 2026 — migrated tenant IDs preserve legacy owner IDs.**
Legacy `company_id ?? user.id` identified the salon; owner rows had null company_id
and a non-null isOwner. Copy the owner's numeric `users.id` verbatim as a string
`Tenant.id`, and preserve other migrated row IDs, especially User IDs referenced by
sales, commissions, leave and department joins. New tenants use generated `cuid()`
IDs. Import must be idempotent/restartable, validate source uniqueness, and check
collisions before importing a second legacy instance. Never assume tenant ID equals
owner ID in application code; `Tenant.ownerUserId` is a separate nullable unique FK
with a creation-order cycle. Platform-admin IDs need not be preserved.

Rationale: avoid permanent mapping joins, broken frozen-client references and mutable
natural keys. Cost: legacy IDs remain guessable; authorization must depend on verified
tenant scope, never ID opacity. Schema permits the policy but does not implement it.
October 17 review found no importer or repeat-run fixture test; seed generates IDs.
Source: `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts`. Import execution
and uniqueness/restartability evidence remain future migration work, not launch proof.

### ADR 0003

**Accepted October 1, 2026 — customer email uniqueness is per tenant.**
Use nullable email and `@@unique([tenantId, email])`, never a global email unique.
Policy requires trim + lowercase in every writer (API, seed, importer and admin tools)
and blank/whitespace -> NULL, so multiple no-email customers remain possible. Typed
casing and the difference between never-provided/cleared/blank are not retained.
The same email in two salons denotes separate customer records. This avoids blocking
legitimate multi-salon customers and leaking cross-tenant existence via uniqueness
errors. A global account model, partial unique index and citext were not chosen.

October 17 review: schema composite uniqueness/nullability and tenant scoping exist,
but shared validators/service do not trim/lowercase; blank input is rejected rather
than nulled. Case-sensitive duplicate emails are therefore possible. The old claim
that no Customer model exists is obsolete. Legacy raw uniqueness was stricter, but
normalization may collapse differently cased values: audit before normalizing existing
data rather than assuming a safe cleanup-free import. Sources: `packages/shared/src/schemas/customer.ts`,
`apps/api/src/services/customer.service.ts`, `apps/api/prisma/schema.prisma`.

### ADR 0004

**Accepted October 1, 2026 — the platform console is a separate, unscheduled app.**
If scheduled, place it in `apps/platform`, not in the salon bundle or a second web
build. Use shared contracts and the same API/database; do not create another API.
Historical dev port reservation is 5174 (web 5173); confirm availability before use.
Add the platform auth realm to constants, the database enum and login only when
building that app, with a reviewed migration. Existing web routes must reject other
realms. This decision does not schedule console work or prove an app/endpoint exists.

Platform bypass must be restricted to platform-plane models: PlatformAdmin (no tenantId),
Tenant, TenantModule, Subscription, Payment and AuditLog, using the controlled
`runAsPlatform()` boundary. Preserve frozen mobile contracts. Rationale: isolate the
privileged UI/session surface without duplicating auth/audit infrastructure. Costs:
another app and a future choice about shared UI primitives, not decided here.
Workspace separation is intent, not proof that cross-app relative imports are
impossible; no placement enforcement test was established. Historical container/CI
assumptions do not authorize Docker/Actions work. Source: workspace manifests and
`packages/shared/src/constants.ts`; confirm current realm/schema before implementation.

### ADR 0005

**Accepted October 1, 2026 — Services is a catalogue tab, not a rail destination.**
Eight destinations: Dashboard, Sale, Appointments, Customers, Products, Staff,
Reports and Settings. Last two are manager/super-admin restricted; entitlement
filtering can hide more. Keep existing labels (not proposal Home/Calendar) unless
separately approved. Services remains available in Products, sale and booking flows;
do not add `/services`, duplicate `/products` rail entries or remove the domain.
Products has Products/Services/Packages/Gift cards tabs with distinct columns.
Sidebar Settings/logout placement and live open-cart badge are separate design work.
Rationale: avoid duplicated catalogues/active-route ambiguity. Cost: discoverability
depends on genuine tabs and flow entry points. October 15 evidence: navigation and
Products tests cover absence of Services nav, presence of Services tab and duration
rather than stock columns; not full visual/catalogue acceptance. Sources:
`apps/web/src/constants/navigation.ts`, `apps/web/src/routes.tsx`, `apps/web/src/pages/Products.tsx`.

### ADR 0006

**Accepted October 1, 2026 — snap handoff values to existing tokens and record deltas.**
Use nearest token; typographic ties round up for legibility. Dimensional differences
must be <=1px; larger gaps require an explicit decision, not invented component
values or a second general-purpose `--app-*` namespace. Map colors to established
palette where appropriate; pixel distance is not a color metric. Conflicting button
drawings (~37/43px) yield to the 44px control token/tap-target rule. Source/copy tokens
stay identical; ADR 0009 is the specific approved historical amber exception, not
blanket permission to edit design assets. See Design 7 for all reconciled deltas.
Costs: intentional half-pixel visual differences, not pixel-perfect matching.
Class tests guard utilities; jsdom does not measure layout. October 17 evidence
reported identical tokens and emitted fractional utilities, not a new browser audit.

### ADR 0007

**Accepted October 2, 2026 — logout revokes one refresh token, not all sessions.**
Hash the presented refresh token and revoke that row; unknown/already-revoked token
returns 200 idempotently without requiring a still-valid access token. Do not bump
tokenVersion on ordinary logout. Discard browser credentials/caches; successfully
revoked refresh cannot renew the access token, which may remain usable up to its
15-minute TTL. Password change and future platform forced sign-out must increment
tokenVersion to invalidate every device; use SESSION_INVALIDATED for invalid sessions.
Avoid an access-token denylist or minute-long refresh cycle for ordinary logout.

October 15 review: logout implementation matches, but refresh replay of any revoked
token (including logout) revokes other refresh sessions. Password update and refresh
revocation are separate writes; race/failure safety is unproven. Browser best-effort
logout failure does not prove server revocation. Platform forced sign-out is not
implemented. Auth route tests were inspected, not run in that review; mocked
AuthContext tests prove local behavior only. Sources: `apps/api/src/services/auth.service.ts`,
`apps/api/src/middleware/auth.ts`, `apps/api/src/routes/auth.routes.test.ts`,
`apps/web/src/contexts/AuthContext.tsx`. Resolve security policy in P0-09.

### ADR 0008

**Accepted October 3, 2026; redraw October 8 — compose login from delivered primitives.**
No login screen was supplied. Use the app background and a centered Card with email,
password and full-width submit; no rail/topbar or new bespoke tokens/values. Keep auth,
guard and refresh behavior independent of layout. Suspended tenants may enter a
read-only session with a purple notice; expired access uses the actionable error
branch. Dispatch by TENANT_SUSPENDED/TENANT_EXPIRED code, not string matching.
Honor safe same-origin `?next=` and reject open redirects. This is an approved
composition, not a pixel-matched design claim; no legacy page copy or invented tokens.

October 8 redraw supersedes the original centered-card arrangement: two columns
from lg up, decorative aria-hidden navy brand panel, one semantic h1; panel hidden
below lg and mark shown within form. Panel uses existing dark-muted/accent/navy-tint
tokens, with --app-auth-panel-w in app-chrome.css. Form uses rounded-card border
border-line bg-surface p-6 rather than Card's table-body padding; shared Card stays
unchanged. October 17 review's centered-Card description conflicts with this later
layout record; verify current Login before making any fidelity claim.
The redraw replaced the Lock subject with a purple G mark; keep Lock exported
to preserve the one-to-one icon port. Password reveal uses Field + CONTROL_CLASS
and a 44px Eye IconButton without changing shared Input for one screen. Preserve
password value/label and in-flight aria-busy/disabled behavior. Amber now exists,
but purple notice remains an intentional choice. October 17 review found composition
and corresponding login/navigation tests present. Sources: `apps/web/src/pages/Login.tsx`,
`apps/web/src/pages/__tests__/Login.test.tsx`, `apps/web/src/constants/navigation.test.ts`.

### ADR 0009

**Accepted October 4, 2026 — approved amber surface/text pair closes Q23.**
Historical approved change added designer-originated `--sp-amber-bg: #FFF4DE` and
`--sp-amber-text: #B9740A` to the source and recopied tokens. Keep gradient stops
`--sp-amber-grad-a/b` separate and unchanged. Badge warning uses bg-warning-soft /
text-warning, dot bg-warning; five tones remain distinct. Do not substitute purple
for Gold, derive badges from saturated gradient stops or invent app-only amber.
This was a specific reversal of the no-source-edit rule for a genuine delivered-CSS
gap, not current permission to modify source design. Purple login notice stays.
Enforcement: Badge class tests and byte comparison of tokens; no automated proof
was established that source hexes always match handoff HTML. Costs: source contains
one approved pair beyond original delivery. Q23 is closed, not an open blocker.

### ADR 0010

**Accepted October 5, 2026 — low-stock threshold is a per-tenant integer.**
Tenant.lowStockThreshold is non-null, default 5; low means quantity <= threshold,
distinct from zero-stock. Compute flags/counts on server, not the visible client
page. Policy: query threshold override affects filtering, while row lowStock uses
stored tenant threshold. Tenant reads must name currentScope().tenantId explicitly;
Tenant is not automatically tenant-scoped. Avoid global constants, per-product
reorder rules or an invented settings key/value model for this one value.

October 15 review: code uses resolved override for both filters and flags, conflicting
with policy. Missing tenant falls back to 5; explicit override bypasses tenant read.
Settings now edits integer 0–10,000 for SUPER_ADMIN/MANAGER in a writable tenant;
old SQL-only deferral is obsolete. Tests cover override count, not row flags.
Resolve semantics before changing code. Sources: `apps/api/src/services/catalogue.service.ts`,
`apps/api/src/services/settings.service.ts`, `packages/shared/src/schemas/settings.ts`,
migration `20261005030037_tenant_low_stock_threshold`. Review did not verify deployment.

### ADR 0011

**Accepted October 6, 2026 — receipt numbers are per-tenant transactional sequences.**
Counter starts at 0; allocate 1..999,999,999 using atomic increment in the sale
transaction; enforce unique (tenantId, receiptNumber). Failure should roll back the
allocation with sale/ledgers; past MAX_RECEIPT_NUMBER refuse 409 RECEIPT_NUMBER_EXHAUSTED.
Do not use global/random references or expose cuid as the human receipt number.
Never reset/reuse consumed numbers; no reset API. Cost: serialization on the salon's
counter row. Legacy null receipts must display an honest unassigned state, not
invent numbers on reads or assume a background backfill.

October 15 review: writeSale and guarded held-sale completeSale both allocate;
creating a hold does not. Null is also valid for current holds, not only imports.
ReceiptView says number pending/shortly although no completed-sale backfill exists.
Sequential tests do not establish concurrency, rollback or ceiling behavior.
Sources: `apps/api/src/services/sale.service.ts`, `packages/shared/src/schemas/sales.ts`,
`packages/shared/src/constants.ts`, `apps/web/src/components/sale/ReceiptView.tsx`,
migration `20261005201500_sale_tenders_receipt_number_and_idempotency`.

### ADR 0012

**Accepted October 6, 2026 — tenders are SalePayment rows, not free-text sale fields.**
Persist tenant/sale FKs, enum method, Decimal(12,2) amount and optional sessionId per
tender. Derive paidAmount/paymentStatus from payments[] inside the same completion
transaction; never accept authoritative paid totals/prices. Bound by MAX_SALE_PAYMENTS.
One checkout contract handles cash/card/splits; held completion uses the same writer.
Avoid fixed cash/card columns, JSON splits and independent inconsistent endpoints.
Cost: importing legacy cash_50_card_25 strings requires explicit parsing rather than
guessing. No tender is legal; zero-total completed sales can be PAID, unlike the old
blanket UNPAID claim. Holds must not carry tenders.

sessionId is optional trimmed metadata <=255 chars for any method, neither required
for CARD nor verified against a gateway. PaymentDialog posts method/amount only.
Recording card/local payment is not acquiring, settlement or refund integration.
API split tests were inspected in the review, not proof of rollback/concurrency;
shared/mocked web tests do not establish settlement. Sources: sale service/contracts,
`apps/api/src/lib/sale-ledgers.test.ts` and the receipt/tender migration above.

### ADR 0013

**Accepted October 8, 2026 — booking duration and performer derive from the service.**
Require serviceId; server determines duration/end. Shared non-strict validators strip
unknown duration/endsAt keys, not reject them. Null catalogue duration currently
falls back to 60 minutes in API/drawer (not a missing-duration refusal). Performer
must exist in tenant and belong to service department if present; absent department
permits any tenant staff; null staff permits unassigned booking. Drawer narrows and
clears incompatible staff on service change. Till department filtering is advice:
sale API checks tenant staff existence, intentionally allowing actual work attribution
outside the department. Do not invent a skill matrix absent maintainable data.

October 15 review: booking-time snapshot contract conflicts with refresh of duration,
end and department eligibility on every PATCH. Service-only/unrelated catalogue-driven
resizing can bypass clash checks. Active staff/service filters exist in picker but
not server eligibility; department mismatch gives 400 STAFF_NOT_IN_DEPARTMENT without
body.staffId detail, so form-level rather than field error. Missing rows give 404.
Old tests overstated department/drawer coverage; add tests for no-department,
unassigned, fallback, snapshot, resize and filter reset cases. Sources:
`apps/api/src/services/appointment.service.ts`, `packages/shared/src/schemas/appointment.ts`,
`apps/web/src/components/appointments/AppointmentFormDrawer.tsx`, `apps/web/src/pages/Sale.tsx`.

### ADR 0014

**Accepted October 12, 2026 — refuse staff overlaps, not dismissible warnings.**
Half-open overlap: existing.startsAt < new.endsAt && existing.endsAt > new.startsAt.
Back-to-back edges are valid. All statuses except CANCELLED occupy time, including
NO_SHOW/COMPLETED. Null staff skips clash validation only (other failures still apply).
Exclude self on update; validate merged window/performer/status on every relevant
change, no role override. Message identifies conflicting customer or walk-in and
window. Departments do not allow one person to occupy two places.

October 15 review: actual 409 code is APPOINTMENT_CLASH, not historical CONFLICT;
no field details; times use server runtime zone, requiring salon-zone review.
Status-only reactivation skips clash check; cancelled targets can be wrongly refused;
resizing in ADR 0013 bypasses it. These sequential defects are distinct from concurrent
check/write races. App checks do not establish atomic exclusion or a measured race
window; future PostgreSQL EXCLUDE/tstzrange + btree_gist is an option requiring a
reviewed migration, not implemented policy. Drag uses dedicated optimistic mutation,
cancels/snapshots list/calendar caches, restores snapshots on error and invalidates;
an unassigned drop is not guaranteed to succeed. Current drag uses useRescheduleAppointment,
not useUpdateAppointment; its onError also throws, so error/toast delivery needs a
focused mutation test. Inspect existing conflicting rows and range types before any
database exclusion migration. Historical tests cover basic
clashes/edges/self, not every status transition, resize, rollback or concurrent write.
The optimistic rollback is not proof of safe overlapping mutations. Historical
service tests had five occupying-status assertions; frontend 32-test result mocked
the drawer and did not prove drag lifecycle or API eligibility. Source: appointment
service/tests and `apps/web/src/hooks/useAppointments.ts`.

October 21, 2026 continuation: application-level tenant-row lock (`lockBookingCalendar`,
`SELECT ... FROM tenants WHERE id = ... FOR NO KEY UPDATE`) now serializes all API booking
writes for a salon — create, update, cancel, series cancellation, booking-link issue and
public booking actions — so overlap, resource and staff-availability reads occur inside
one ReadCommitted transaction per salon. Message jobs are written in the same transaction
and therefore publish only after a successful commit. Lock coverage is API-only; direct SQL
writers remain outside it. PostgreSQL `EXCLUDE`/`tstzrange` remains an optional future
defense-in-depth measure, not implemented policy (ADR 0014).

### ADR 0015

October 19 continuation: held lists now support Previous/Next pages through the
sales API's optional `page` and returned `hasMore`. History separately browses
COMPLETED/VOID and opens stored receipts without replacing the active draft.
API/UI regression tests cover paging, tenant isolation and preserved resumed-hold
identity. User accepted history/pagination on October 19. Durable browser hold keys
now reuse an unchanged submitted attempt across reload, and in-flight edits are
blocked. Concurrent API replay is tested; changed carts after uncertain responses
are new attempts and require checking existing holds. Older limit-only/missing-key
findings below are historical. Current-catalogue pickup is now implemented.
Read-only `GET /api/sales/:id/resume` resolves exact current catalogue prices (both
regular/member), validates item availability/entitlements and refuses non-held sales.
Local pickup preserves cashier choices and requires confirmation before replacing a
draft; failure/cancel leaves it intact. Conflicting hold actions/edits are blocked
while pending and late unmounted pickup responses are ignored. No reservation or
ownership lock is introduced. Prices/state may change after pickup; completion remains
authoritative. Reload restores the saved browser quote, not a guaranteed live price.
API/UI regressions pass; manual pickup UAT remains unperformed.
Offset paging is a live view, not snapshot/export isolation. Manual fault-injection
acceptance of durable hold retries remains unperformed.

**Accepted October 14, 2026 — held sales are tenant-visible drafts, not revenue.**
HELD Sale + ordered lines gets no number, tender, stock reservation, points,
performance, outstanding or granted holdings. Reporting reads COMPLETED only.
Complete using current cart/customer/tenders and server catalogue pricing; rewrite
draft lines and fill ledgers/number in one guarded transition. Pickup is not ownership
or a lock; any authorized salon till can resume. Discard hard-deletes only HELD;
COMPLETED/VOID refuse 409 SALE_NOT_HELD. No automatic expiry policy/scheduler.

October 15 review: soldAt is set when parked then overwritten at completion; completion
can leave debt rather than prove cash received. Parking still validates stock,
entitlements/customer/performer. Completion can fail initial 400 BAD_REQUEST quantity
or guarded 409 INSUFFICIENT_STOCK. Sequential completed replay returns receipt;
concurrent loser may get HOLD_ALREADY_COMPLETED. Lists are newest 50, no cursor/total
or truncation notice, so not every hold is reachable. Pickup edits are local and
leave-held loses them; local cart replacement, stale price/double-discount preview,
lost hold ID after reload and missing browser idempotency keys can duplicate drafts.
Do not freeze old prices or reserve stock as a documentation-driven fix.
Sources: sale service/contracts, `apps/web/src/hooks/useSale.ts`, HeldCartsPanel,
sale-draft-storage and Sale tests. Shared 35 tests passed historically; web output
reported 26 tests but wrapper exit was not confirmed in the earlier hold review.
API inspection did not prove concurrent lifecycle or all ledger effects. Preserve
that limitation rather than treating a later broad baseline as targeted race proof.

### ADR 0016

October 19 backend integrity continuation: void/refund load reversal inputs after
locking the sale; concurrent void retries preserve the first audit and receipt.
Missing product stock targets or redeemed holding restoration targets abort the
whole transaction. Holding row locks serialize package/credit consumption against
granting-sale void; outstanding row is locked before its payment check. Targeted
DB race regressions pass, not an exhaustive deadlock/load proof.
Migration `20261019210000_receipt_parent_retention` changes customer/cashier/performer
receipt links from Cascade to Restrict; completed/void receipt survival is tested.
Use account archival rather than deleting referenced parents. Names remain live
references and whole-tenant erasure policy is unchanged. Earlier findings below
about cascades, ignored stock counts and concurrent void replay are historical;
UI outstanding/cache/history fixes are also already delivered. Pickup UAT accepted
by user October 19; no agent browser walkthrough for this backend continuation.

**Accepted October 14, 2026 — a void records a terminal whole-sale reversal.**
Keep sale/lines/number/tenders and original paid amount; set VOID/time/reason/actor.
Only SUPER_ADMIN/MANAGER in writable entitled tenant; actor comes from verified JWT,
not body. Reason trimmed 3–500 chars. In same guarded transaction restore product
quantity, offset net points with negative rows (never edit/delete original points),
delete granted unspent holdings, outstanding debt, performance and commission rows.
Refuse HELD (discard instead), spent holdings and later payments against outstanding
debt (409 SALE_NOT_COMPLETED/HOLDING_ALREADY_SPENT/OUTSTANDING_ALREADY_PAID).
Initial partial tender alone is not the later-payment refusal. Keep receipt number
consumed. Sequential replays preserve first actor/reason; no unvoid or line-level
return here. Reports exclude VOID; a future void-summary report is separate work.

This does not return money: cashier/manager must refund outside this till; paid
history remains. Concurrent loser can get SALE_ALREADY_VOID; pretransaction snapshots
and read-only holding/debt checks do not prove isolation from redemption/payments.
Stock restore ignores updateMany matched count (deleted product can be skipped).
Customer/cashier Cascade deletion can delete receipts despite void-actor SET NULL;
voidedByName is live, not immutable snapshot. Voided unpaid receipts can still show
Outstanding; void invalidation misses business-summary/report/customer caches.
API VOID listing is capped and there is no dedicated historical-void browser in Sale;
void is offered from the current receipt. Historical API claims exceed coverage for holding types, commission deletion, races,
missing products and parent deletion. Sources: sale service/routes/schema, VoidSaleDialog,
ReceiptView, sale hooks and migration `20261014043155_sale_void_reason_and_actor`.
Historical shared 35 and mocked web 23 tests passed; not proof of ledger isolation,
all reversal types, thermal output or unchanged first actor under a different actor replay.

### ADR 0017

October 19 POS continuation: the user approved L2 + E1 + R1 + A1 + P1. Discounted
loyalty snapshots, recorded exact money payout splits and refund-date accounting
adjustments are implemented in `docs/ADR-0020-pos-vouchers-refunds.md`. The ADR
remains explicitly reconstructed; subsequent policy approval is recorded separately.

**Accepted October 14, 2026 — discount is a recorded line percentage, not posted price.**
Rate 0–100 with <=2 decimals; unknown price fields stripped; catalogue/member price
remains authoritative. Decimal arithmetic: discountPerUnit = round(listPrice × rate /
100, 2); unitPrice = listPrice − discountPerUnit; discountAmount = discountPerUnit ×
quantity; lineTotal = unitPrice × quantity. Store rate and money (zero defaults),
and expose line/sale discount totals on receipt. Avoid cart-wide allocation, arbitrary
price overrides or unapproved caps. Any authorized till user may discount up to 100%
without extra approval; future caps/approvers/commission basis need explicit policy.

Historical discrepancy resolved October 19 by ADR 0020 L2/E1: catalogue points ×
quantity × net/original amount, floored per line with snapshotted inputs/results;
earned on completion regardless of debt/tender. Performance uses net discounted
line totals; no positive commission rows are computed by this path. DB has no arithmetic/rate
CHECK constraints. Web normalizes/caps on blur/Enter; step=1 permits contract decimals;
JS preview is not exhaustive Decimal equivalence. Receipt omits positive rates rounded
to zero money. Shared 35 and mocked web 29 tests historically passed; no live ledger,
thermal print or complete receipt-disclosure proof follows. Sources: sale service,
sales contracts, useSale, CartLine, money, ReceiptView and migration
`20261014044809_sale_line_discount`.

### ADR 0018

**October 20, 2026 — TK2610-0018 extension approved by the user.** This supersedes
the historical week/month non-dragging and single-page decisions below. Week now
has Monday-first day/staff tracks (including Unassigned), quarter-hour date/time/staff
drops and overlap lanes. Month supports date drops preserving salon-local start time
and performer; padded dates remain outside the loaded month and are not drop targets.
Month overflow expands to expose every chip. Both retain click-to-edit for keyboard use
and enforce suspended-tenant read-only behavior. Calendar and active-roster reads fetch
all pages, with failures surfaced instead of a partial grid; calendar reads opt into
overlap selection while the list retains starts-within semantics. Occupied dates include
overnight carry-in, excluding exact end boundaries. Time grids retain 08:00–20:00 and
disclose that limit; Month exposes off-hours bookings. Salon-zone week/month boundaries
and navigation are independent of the browser timezone. Rescheduling preserves saved
duration unless service changes, updates optimistic start/end together, and rolls back
failed writes. Existing application-level clash checks are still not atomic under
concurrent writes; no database constraint/migration was added. User explicitly accepted
calendar UAT on October 20, 2026 (user-reported, not an agent browser walkthrough).
October 20: user separately authorized cleanup of the three unsafe ESLint configs;
appended code and its createRequire bootstrap were removed without changing lint rules.
Workspace lint and config syntax/format checks passed, resolving the final verification
blocker; TK2610-0018 is DONE. This cleanup is not a repository-wide security audit.

**Accepted October 14, 2026 — shared geometry supports day/week/month views.**
Reuse existing appointment read endpoint, start-day bucketing, Monday-first weeks
and calendar-month range (not padded neighboring-month data). Week shares day
08:00–20:00 scale and geometry; half-open overlap lane packing uses cluster width,
not the busiest width for the whole day. Month draws Monday-first 28/35/42 cells,
max three chips/day and +N more. Week/month have no drag, but click opens editor
for writable tenants; do not confuse presentation with server authorization.
At 200-row ceiling disclose Showing first N of M, not implied availability.

Historical browser-local windows were superseded by newer salon-zone P0-08 work;
verify current helpers rather than reverting it. October 15 review found inclusive
starts-within-window (not overlap) selection, concurrent background list read,
previous-data retention and no auto-pagination. 23:00–01:00 is outside both visible
gutters, but 19:00–09:00 crosses visible spans: not all overnight bookings are
undrawable. Start-day assignment/window selection still omit some occupied time;
query/overnight semantics need review. Five mocked/geometry files, 88 tests passed
then; not proof of deployed reads, clashes, rollback or complete availability.
Sources: calendar-geometry, CalendarView/WeekView/MonthView, Appointments and useAppointments.

### ADR 0019

**Accepted October 19, 2026 — local rails are recorded tenders, and credit redemption is a
tender, not a discount.**
`PAYNOW_SGQR` (PayNow and SGQR share one code, because a salon cannot tell them apart on its
statement), `NETS`, `GRABPAY` and `ATOME` are **manually recorded**: no PSP integration, QR
payload, webhook, settlement or reconciliation in this slice. `sessionId` stays optional
API-only metadata for a future provider. `PACKAGE` and `PREPAID_CREDIT` are tender codes on
`SalePayment`; the sale keeps its total, its points and the stylist's credit, and the receipt
shows what paid for it.

A redemption carries `holdingId`. `redeemPayments` re-reads the holding inside the sale
transaction, recomputes what it covers, subtracts it with a count-guarded update
(`quantityRemaining/amountRemaining >= draw`), and writes one `CustomerRedemption` row naming
the holding (additive column + index, migration
`20261019034125_local_payment_methods_and_redemption_holding`). The amount is verified, not
trusted: a browser cannot invent a balance. Refusals are `404 HOLDING_NOT_FOUND` (foreign or
unknown), `409 HOLDING_EXPIRED` / `HOLDING_INSUFFICIENT`, and `400 HOLDING_NOT_COVERED` /
`HOLDING_REQUIRES_CUSTOMER` / `REDEMPTION_EXCEEDS_TOTAL`.

A **package** covers SERVICE units whose service the package lists, in cart order, one session
per unit, up to what is left; the tender amount must equal that coverage exactly. **Prepaid
credit is fungible** (user decision, October 19): any line, any amount up to the balance, so the
`ValuePackageService` links restrict nothing. Voiding restores both — increment the holding and
stamp `CustomerRedemption.revertedAt` (the legacy `unuse_time`), never delete. `GET
/api/customers/:id/holdings` merges the two ledgers into one list of spendable rows, each naming
the tender that spends it.

Not covered here: gift-card tender, provider settlement, partial refunds of a redemption, a
redemption UI beyond the payment sheet, and "one use = a set of services" package semantics
(that needs its own model in P2-03). Sources: shared `constants.ts` / `sales.ts` /
`customer.ts`, `sale.service` (`redeemPayments`, `reverseForVoid`), `customer.service`
(`getCustomerHoldings`), `PaymentDialog`, and the migration above.

## Design integration

### Design 1

Source package: `design/handoff/`. Eleven HTML screens; PNG references only for 01–04;
tokens CSS/JSON and 41 distinct 24×24 stroke SVGs. Delivered README says 40, but actual
directory count is authoritative. Screens 01–04 were audit-driven; 05–11 are proposals,
not audited live field/permission specifications. Screen 04 is reference fixes, not
a page. Preserve delivered assets and README unchanged. Screen/API mismatches must
change the proposal-derived screen, not invent schema/data to satisfy a drawing.

### Design 2

Frame geometry (desktop reference, not a reason to remove existing responsive work):

| Screen | Container | Reference frame | Rail           |
| ------ | --------- | --------------- | -------------- |
| 01     | .root     | 1280×832        | No             |
| 02     | .root     | 900×832         | No             |
| 03     | .root     | 1280×900        | No             |
| 04     | .root     | 1280×620        | Reference only |
| 05–11  | .app      | 1280×900        | Yes            |

Main shell: 84px navy rail, 76px white topbar with 1px border and 28px sides,
--sp-bg background, 44px minimum tap controls. Historical fixed-frame guidance
allowed sensible scrolling on smaller windows; preserve later responsive behavior.
Measured rail: 50px item height, radius 14px, icon-label gap 4px, item gap 6px;
label 8.5px/700/.01em; 19px icons, stroke-width 1.8. Active solid --sp-purple plus
--sp-shadow-purple-btn. Logo 40×40/radius12 with 22px bottom margin; rail padding
20px 0 16px. Item width deliberately 70px rather than handoff 54: Appointments
measures 61.7px vs Customers 46.4px, preserving ~3.8px side padding without clipping.
Documented app-only values live in `apps/web/src/styles/app-chrome.css`.
Live 16×16 red open-cart badge with 2px navy ring and side-foot placement are separate
data/layout decisions, not claims of completed fidelity. Use the delivered font
family Plus Jakarta Sans/fallback; Google Fonts/preconnect wiring lives in index.css
and web index.html.

### Design 3

Token flow: design/handoff/tokens/tokens.css -> apps/web/src/styles/tokens.css ->
@theme in apps/web/src/index.css -> utilities. Copy stays byte-identical and ignored
by formatter. Do not edit the copy/@theme values in place or introduce component hex/
magic px. Current source assets remain read-only; any future source-token change needs
explicit approval as ADR 0009 historically had. No second general token namespace.
@theme maps color, font-sans, text, radius, spacing (control/rail/topbar) and shadow;
weight/space/navy overlays may use var(). Reused values merit utilities; one-use values
may use existing vars. App-only frame variables --sp-rail-w/--sp-topbar-h and documented
--app-* geometry stay in app-chrome.css, not the source/copy token files. Verify byte
identity, emitted fractional utilities and browser measurements rather than assuming
class assertions prove pixels.

### Design 4

One React component per original SVG in apps/web/src/components/icons, path data
verbatim, no third-party replacements/redrawing; barrel exports PascalCase names.
24×24 viewBox, stroke currentColor, no invented fills. aria-hidden by default,
focusable=false, className passthrough; icon-only button carries aria-label, not icon.
Width/height are 1em, so text-* utilities set size. Historical stand-ins map FiInfo
to Bell (toast), FiLoader to spinning Settings (loading), FiRefreshCw to Eye (re-check)
and FiArrowLeft to ChevronLeft (back). react-icons stand-ins were removed. There is
no right chevron: use delivered ArrowRight, not a mirrored ChevronLeft; adding a
new distinct shape requires explicit source-asset approval, not silent invention.
All 41 remain exported including unused Lock/Scissors. Navigation uses real ModuleCode
values and longest matching path for active state; six role-visible destinations
before entitlement filtering, eight for managers. Icon port/class tests do not prove
browser geometry or accessible control labels across every consumer.

### Design 5

| Screen | Route / flow            | Intended substance                                                   |
| ------ | ----------------------- | -------------------------------------------------------------------- |
| 01     | /sale                   | Searchable catalogue/tabs and always-visible cart                    |
| 02     | Receipt step in /sale   | Single checkout with payments[], not cash/card/split endpoints       |
| 03     | Flow over /appointments | Who/What/When/With, service-derived duration                         |
| 04     | None                    | Live dashboard, subdued delete, cart badge reference fixes           |
| 05     | /                       | Income, today's sales, low stock and open-cart indicators            |
| 06     | /appointments           | Calendar/list                                                        |
| 07     | /customers              | Customer list/profile entry                                          |
| 08     | /products               | Products/Services/Packages/Gift cards tabs; entitlement-aware states |
| 09     | /staff                  | Staff list, no fabricated shift/rating values                        |
| 10     | /reports                | Manager/super-admin nav                                              |
| 11     | /settings               | Manager/super-admin nav                                              |

Do not treat old phase assignments or placeholders as current task status. No separate
Services route (ADR 0005). Exclude unsupported membership tiers, staff ratings/shifts,
product cost/margin or gift-card QR rendering rather than fake values; assess newer
implementations before assuming these fields remain unsupported. No-data and unbought
add-on are different states; gate API and hide Add appropriately without treating
read-only as entitlement absence.

### Design 6

Screen completion check: token-based colors/radii/shadows/control heights; appropriate
reference frame/rail/topbar; original accessible icons; >=44px controls except documented
small steppers; fields/permissions/states checked against real model; tests/format/lint/
types/build and relevant integration checks recorded honestly. Full root verify must
actually exit 0 to claim aggregate success; confirmed disposable DB required for API
tests. Browser geometry/visual checks are separate from mocked DOM class assertions.

### Design 7

Reconciled primitives and intentional deltas (historical browser measurements):

| Selector    | Handoff                         | App utility / decision                       | Delta                 |
| ----------- | ------------------------------- | -------------------------------------------- | --------------------- |
| Card        | radius20, border #E3E6F2        | rounded-card border-line                     | 0                     |
| Card head   | 16px 20px, #EEF0F7 divider      | px-5 py-4 border-line-soft items-center      | 0                     |
| Card title  | 14.5px/800                      | text-base font-heavy (14px)                  | −0.5px                |
| Card body   | 6px 12px 12px                   | px-3 pt-1.5 pb-3                             | 0                     |
| Tier/status | 10.5px/800, 4px 9px             | text-xs font-heavy px-2.25 py-1              | +0.5px                |
| Card link   | 12px/700                        | text-sm font-bold (12.5px)                   | +0.5px                |
| Tab         | 12.5px/700, 13px vertical       | text-sm font-bold h-control                  | Token control height  |
| Chip        | 13px/600, 8px 14px              | text-sm font-medium px-3.5 py-2 bg-surface-2 | −0.5px                |
| Chip color  | #2B3160 / #F3F4FA               | text-ink #1B2350 / bg-surface-2              | Recorded palette snap |
| Button      | radius12, 13.5px/700, 11px 18px | font-bold text-base px-4.5, token radius     | +0.5px                |

Button/Checkbox/Chip-toggle use 44px despite ~30–43px drawings. Selected Chip is solid
purple with white text. Tabs horizontally scroll, active border-b-2 rather than shadow.
Amber warning now uses designer #FFF4DE/#B9740A, not unresolved Q23 or gradient stops.
Class tests prevent utility regressions, not pixel drift; browser getComputedStyle
and builds were the historical measurement/emission checks, not tests rerun here.
