# Glampro Suite — tasks

## How to use

Single merged tracker: DOCX requirements, PDF IDs and existing local work. See
`PROJECT.md` for sources, workflow, ADR 0002–0018 and Design 1–7 sections. Original
PDF dates are planning references only. Inform the user which TK2610 IDs are ready
to mark done, with evidence; the user updates the external system/PDF, never the agent.

New work uses TODO / IN PROGRESS / BLOCKED / DONE. Existing statuses below are
preserved: Not assessed means inspect first; Ready for UAT is not automatically
promoted to Done. Mark Done only when the full expected result and completion
check are met. Preserve explicit readiness sign-off gates. Historical evidence is
not a new test run. Assess code first; follow dependencies rather than date order.

## Multi-company SaaS — approved October 23, 2026

### SAAS-01 — Harden tenant authentication and session administration

- Status: DONE
- Expected result: Token company claims must match the authenticated user's
  company; salon owners cannot revoke another company's sessions. Reject
  unsupported realms before tenant lookups. Preserve legacy tenant-less tokens.
- Completion check: Regression tests for matching/mismatched claims, legacy
  tokens, unsupported realms, same-company revocation and cross-company refusal;
  focused authentication suites, API typecheck/lint and diff review.
- Evidence: October 23: 33/33 focused tests pass, including seven new mocked
  persistence boundary tests; shared build, API typecheck/lint and diff check pass.
  No database migration or application data changes. Live PostgreSQL/HTTP and full
  workspace suites were not run for this task; transaction behavior was checked
  through mocks, not a live rollback rehearsal. Additional schema/status/module
  test command output could not be reliably captured and is not claimed as passed.

### SAAS-02 — Platform authentication and separate portal shell

- Status: DONE — implementation and disposable local verification; application
  migration/bootstrap and production deployment are not performed or implied.
- Dependencies: SAAS-01
- Expected result: Separate operator identity/session surface (now integrated under `/platform/*`)
  login, without granting salon owners platform privileges or unrestricted access
  to tenant business data. Include strong credential/bootstrap and MFA design.
- Completion check: Login/session/revocation and two-way realm rejection tests;
  portal build and authentication tests; reviewed additive migrations on disposable
  data before any authorized application rollout.
- Evidence: Platform UI/client 5/5; focused API authentication 35/35; full sequential
  API 537 passed / 0 failed / 11 opt-in skips on disposable PostgreSQL; salon web
  606/606; shared 161/161. Workspace typecheck/lint/build pass. Separate opt-in
  real PostgreSQL/HTTP/loopback SMTP acceptance passes, including concurrent MFA
  replay, attempt limits/expiry, refresh reuse, logout and two-way realm isolation.
  Bootstrap first creation succeeds; repeat initialization and weak password fail.
  All 41 migrations replay on disposable databases. Schema diff reports unrelated
  existing prepaid/treatment constraint/index drift, no platform-auth differences;
  not fixed here. See PROJECT.md for operational setup and limitations.

### SAAS-03 — Company management and secure owner onboarding

- Status: DONE — local implementation/disposable verification; application rollout
  not performed.
- Dependencies: SAAS-02
- Expected result: Platform company list/details and atomic creation with secure,
  expiring one-time owner invitations; no default passwords or public signup.
- Completion check: Two-company isolation, duplicate/invalid creation, invitation
  expiry/replay and transaction rollback tests; portal workflow verification.

- Evidence: Real PostgreSQL/HTTP/loopback SMTP acceptance passes for two companies,
  owner activation plus existing MFA login, isolated customer reads, platform access
  refusal for owners, invalid input, duplicate slug/email rollback, audit-FK failure
  rollback, resend invalidation, expiry, replay and concurrent acceptance. Closed
  SMTP test confirms committed company plus failed delivery result. Full API 537
  passed / 0 failed / 12 opt-in skips; web 609/609; shared 164/164; platform 9/9.
  Workspace typecheck/lint/build pass; all 42 migrations replayed on disposable DB.
  No application migration/accounts/deployment, commit or push.

### SAAS-05 — Integrate platform portal into the main frontend

- Status: DONE — implementation and local automated verification; no deployment.
- Dependencies: SAAS-03
- Expected result: Salon `/login` and operator `/platform/login` share port 5173
  and the existing API, without a separate platform dev command. Preserve separate
  platform credentials, MFA, sessions and API authorization; isolate salon providers
  and platform styles.
- Completion check: Portal routing/provider isolation, login/MFA/logout regression
  tests; web suite, lint/typecheck/build and local URL checks. No database changes.
- Evidence: October 23: 625/625 web tests, web lint and root build (including API
  and web TypeScript checks) pass. Focused API authentication suites 40/40 pass.
  Disposable Vite on 55173 serves `/login`, `/platform/login`, `/platform` and both
  source entry modules with HTTP 200; stopped afterward. UI redirects/MFA/logout
  exercised through component tests, not live account/SMTP or browser acceptance.
  Platform API client/company workflows moved unchanged; separate workspace and
  startup/build scripts removed. No migrations, accounts, deployment, commit or push.

### SAAS-04 — Subscription, lifecycle, entitlements and audit management

- Status: DONE — local implementation and automated/disposable verification;
  application rollout and deployment not performed.
- Dependencies: SAAS-03
- Expected result: Manual subscriptions, feature access, suspend/reactivate/cancel
  workflows and attributable audit history. No automatic billing, deletion or
  impersonation. Verify status/session policy rather than assume foundations work.
- Completion check: Authorized/unauthorized lifecycle and entitlement tests,
  audit atomicity, two-company end-to-end isolation and available workspace checks.
- Evidence: October 23: real PostgreSQL/HTTP acceptance passes on disposable loopback
  port 55442 after replaying all 42 migrations. Verified platform-only access,
  concurrent subscription overlap rejection, decimal/date validation, tenant isolation,
  grant/expiry/revoke on existing sessions, lifecycle access/refresh revocation,
  suspended read-only login, cancelled/expired refusal, renewal/reactivation and
  transaction rollback when audit FK fails. Audit actor/reason/paging/isolation pass.
  Full sequential API: 537 passed / 0 failed / 13 opt-in skips; separate SAAS-04
  gated acceptance passed. Web 629/629, shared 167/167; root build, workspace
  typecheck/lint, final web typecheck/lint, formatting and diff checks pass.
- Scope: Current manual subscription periods only; no payment collection/ledger,
  future scheduling/history editing, cap administration, deletion or impersonation.
  UI tests, not agent browser UAT. Initial parallel web lazy-import timeout passed
  with two workers and unchanged assertions. No new migration or real account changes.

## Documentation consolidation

Standing acceptance override (October 22, 2026): the user accepts all manual
UAT/browser/review gates when implementation and available automated verification
are complete. No further manual sign-off request is required. Record acceptance
as user-granted, not agent-executed testing. Unfinished features, failed checks and
unperformed migrations/deployments/external submissions are not completed by this
instruction. See PROJECT.md for the standing rule.

### DOCS-01 — Consolidate project documentation

- Status: DONE
- Expected result: PROJECT/TASKS/PROGRESS are the only maintained project documents;
  merge decision/design/rule context and remove superseded docs and project rule.
- Completion check: all 29 PDF IDs and 24 DOCX product requirements retained; prior
  statuses preserved; unresolved findings migrated; active references valid; original
  sources, design and existing application changes untouched; formatting/diff pass.
- Evidence: clarified three-document scope completed October 17. All 29 PDF IDs,
  24 DOCX task requirements and 37 prior statuses preserved; ADR 0002–0018 and
  Design 1–7 consolidated in PROJECT. Removed 20 superseded decision/design/rule
  files; docs contains only original DOCX/PDF. All 66 source/schema reference edits
  are comment-only; 287 other snapshot files unchanged. Focused web 56/56 and shared
  53/53 tests pass; Prettier and diff/reference checks pass. No database commands.

## Local setup and completed groundwork

### SETUP-01 — Tracker and session handoff

- Status: Done
- Expected result / completion check: All external IDs retained and startup references resolve.
- Evidence / next: Previously Done; migration coverage recorded in DOCS-01.

### SETUP-02 — Root tooling / baseline health

- Status: Done
- Expected result / completion check: Run formatting, lint, typecheck, tests and migration checks on a confirmed disposable database; disclose failures.
- Evidence / next: Previously Done: API 308, web 381, shared 87 tests; lint/typecheck passed October 17. Aggregate verify was not clean: seven pre-existing format failures. See PROGRESS.md.

### SETUP-03 — Glampro Suite web branding

- Status: Done
- Expected result / completion check: Review desktop/mobile branding and focused UI checks.
- Evidence / next: Accepted October 15, 2026; earlier login/dashboard 19 tests, typecheck/lint passed. Trademark/domain work stays in P2-06.

### SETUP-04 — GitHub rename and local origin

- Status: Done
- Expected result / completion check: Confirm repository identity and local origin without rewriting history.
- Evidence / next: Recorded complete October 15; repository identity and SSH remote check passed then. Other clones/integrations were not verified.

### SETUP-05 — Reported database rename

- Status: Done
- Expected result / completion check: Confirm environment, actual database name, backups/data preservation and secret-safe connection configuration.
- Evidence / next: Verified October 18, 2026. Environment: PostgreSQL at `localhost:5432`, database `glampro_suite`, shadow `glampro_shadow` (both on 5432; the commented-out `SHADOW_DATABASE_URL` in `apps/api/.env` points at stale port 5433 where nothing listens — do not uncomment as-is). `.env` was never committed to git. Schema drift found and repaired additively via `npm run db:migrate`, no reset/reseed: applied pending `20261015210000_tenant_localisation` and `20261016151623_tenant_operating_hours`, then generated and applied `20261018141510_user_two_factor_auth` for P0-09's previously unmigrated 2FA columns. Backup taken before edits: `backups/glampro_suite_2026-10-18.dump` (pg_dump, ~125KB); `backups/` added to `.gitignore`. Checks: `prisma migrate status` → 12 migrations, database schema up to date; `prisma migrate diff` live-DB↔schema and migrations↔schema both "No difference detected" (exit 0); 0 rolled-back migrations; API tests 308/308 pass.

### SETUP-06 — Documentation audit

- Status: Done
- Expected result / completion check: Review relevant ADRs against code and retain unresolved findings.
- Evidence / next: Previously Done; product decisions/findings remain open in PROGRESS.md and related tasks.

### SETUP-07 — Decision records and relative links

- Status: Done
- Expected result / completion check: Retain decision IDs, index and evidence reviews; distinguish historical citations.
- Evidence / next: Previously Done; ADRs 0002–0018 consolidated in PROJECT.md with stable IDs. Historical missing source documents are not restored.

### SETUP-08 — ADR 0008 evidence review and commit

- Status: Done
- Expected result / completion check: Preserve reviewed evidence without duplicate review sections.
- Evidence / next: Recorded complete in commit 257eead with ADRs 0002/0003/0006/0008 reviews; no new commit made here.

## Product roadmap and readiness gates

### SEC-01 — Complete launch authentication security

- Status: DONE
- User acceptance (October 22, 2026): user explicitly confirmed "manual browser/user is accepted." This closes the remaining manual acceptance gate based on user-reported testing, not an agent browser walkthrough. Production SMTP delivery/account audit and the unrelated treatment-service lint issue remain disclosed limits; no production changes or P2 phase sign-off implied.
- Resource approval (October 22, 2026): user approved disposable local PostgreSQL and loopback-only SMTP capture for acceptance. Application/production databases, existing accounts and external mail remain out of scope.
- Acceptance evidence (October 22, 2026): provisioned an independent temporary PostgreSQL 18 cluster on loopback port 55439, database sec01_acceptance; all migrations applied. New opt-in auth-security.acceptance.test.ts passes against real persistence and an in-memory loopback SMTP capture server (1/1, no skips). Owner challenge/enrollment, hashed code storage, replay rejection, mandatory 2FA, weak-password refusal, password-change access/refresh revocation and staff optional enrollment/login/disable verified. Authentication regression tests 38/38; Login/Settings UI 32/32; API typecheck, new-test ESLint/Prettier and diff check pass. Fixture removed and temporary cluster stopped. No application database or external email used.
- Remaining operational limits: production SMTP/account audit not performed. Manual browser/user acceptance is now recorded above. Existing whole-API treatment-service lint failure remains outside this slice. Package-expiry work is next, not started automatically.
- Expected result: browser email-code login and optional enrollment; mandatory SUPER_ADMIN verification; stronger administrator passwords; production seed refuses unsafe configuration. Preserve accounts and historical records.
- Completion check: focused authentication/UI/seed tests, typechecks and lint pass; disclose production SMTP/account-audit and integration-test limitations. Reassesses TK2610-0005 without deleting historical acceptance.
- Dependencies: existing authentication and email transport. No production account changes authorized.
- Implementation: explicit challenge/session API, mandatory SUPER_ADMIN email verification,
  optional Settings enrollment, single-use purpose-bound codes, production seed guard,
  stronger new/change owner credentials. Existing credentials/accounts preserved.
- Evidence: web 481/481, shared 136/136; focused mocked API/seed security 15/15;
  API/web typechecks, web build/lint and changed API lint pass. Whole API lint blocked
  by existing treatment.service.ts:174 no-explicit-any. No database/SMTP acceptance
  or deployment performed in that implementation run; acceptance remains pending.
- Acceptance follow-up (October 22, 2026): isolated API/seed security tests 15/15
  and Login/Settings UI tests 32/32 pass; API/web typechecks and focused security
  API lint pass. Environment inspection found only the application database
  `glampro_suite`, no TEST_DATABASE_URL, and no SMTP_HOST. No database-writing
  tests, migrations, seeding or outbound mail were run. BLOCKED pending approval
  to provision a separate disposable database and local SMTP inbox, or provision
  of approved acceptance resources. Package-expiry work remains next, not started.

PDF phase/milestone IDs are retained alongside the 24 product tasks. Within each
phase, use the listed order unless dependencies or unresolved policy block it.

### TK2610-0001 — Phase 1 – P0 Launch blockers

- Status: DONE
- Expected result: complete all P0 product tasks.
- Completion check / dependencies: all P0 child checks met, evidence reviewed and explicit phase sign-off recorded. Child completion alone does not sign off a phase.
- Sign-off (October 19, 2026): all nine P0 children are recorded Done and the user
  explicitly confirmed P0 readiness: "yes it's done and ready. please continue".
  P0 phase/readiness approval is recorded through TK2610-0013, with its disclosed
  scope and verification limits retained. This is not final launch approval.

### TK2610-0004 — P0-07 Remove developer copy & system-status panel

- Status: Done
- Expected result: Remove developer copy (ADR refs, 'server charges catalogue', design-system note, internal keys, system-status panel)
- Completion check / dependencies: Check customer-facing screens for developer copy, internal keys and diagnostic panels; verify friendly refusal messages and responsive appearance.
- Historical evidence: Developer copy removed from Dashboard diagnostics, Settings, Sale and the gift-card form; add-on refusals use display names and unknown-module messages omit internal keys. User accepted desktop/mobile review on 2026-10-15. Middleware gate passed: 7 integration tests, none skipped, on explicitly approved isolated disposable PostgreSQL; no existing database accessed. Web 40 files / 354 tests, shared 83 tests, API/web typechecks, scoped ESLint, Prettier and whitespace passed.

### TK2610-0005 — P0-09 Security hardening

- Status: DONE
- Expected result: Token replay does not revoke other sessions, password change + refresh revocation is atomic, platform forced sign-out exists, email-code 2FA for owners, test accounts retained
- Completion check / dependencies: Token replay rejects without family revocation (ADR 0007); password change wraps tokenVersion bump + refresh revocation in a single transaction; `POST /api/auth/force-sign-out` (SUPER_ADMIN only) bumps tokenVersion and revokes all refresh tokens atomically; email-code 2FA with enable/confirm/disable/verify-login endpoints; test accounts retained per user decision. Originally marked complete on manual code review with integration tests blocked by the `time_zone` schema mismatch; SETUP-05 fixed that mismatch October 18 and the API integration suite now runs: 308/308 pass, including the replay test aligned to ADR 0007 (`auth.routes.test.ts` updated — its family-revocation assertion was stale pre-P0-09 behavior).
- Evidence: `apps/api/src/services/auth.service.ts` (replay fix, atomic changePassword, forceSignOut, enableTwoFactor, confirmTwoFactor, disableTwoFactor, verifyTwoFactorForLogin, login 2FA gate); `apps/api/src/routes/auth.routes.ts` (five new endpoints); `apps/api/prisma/schema.prisma` (twoFactorEnabled, twoFactorCode, twoFactorCodeExpiresAt on User); `packages/shared/src/schemas/auth.ts` (twoFactor schemas, TWO_FACTOR_CODE_LENGTH, forceSignOutSchema); `packages/shared/src/constants.ts` (TWO_FACTOR_CODE_TTL_SECONDS); `apps/api/src/lib/email.ts` (dev/test email service). API typecheck passes, API lint passes, shared 87/87 tests pass.

### TK2610-0006 — P0-08 Localisation: S$, DD/MM/YYYY, timezone/locale

- Status: Done
- Expected result: Localisation: S$ currency, DD/MM/YYYY, timezone/locale settings
- Completion check / dependencies: Verify persisted locale/timezone, S$, DD/MM/YYYY, date-only values and salon-zone calendar/report/dashboard boundaries across host timezones.
- Historical evidence: Persistence/API/Settings slice validated on disposable PostgreSQL (6 integration tests). Formatting provider now loads tenant-keyed saved settings and reacts to successful saves; catalogue/POS/receipt/profile/report displays use explicit S$, default DD/MM/YYYY and salon-zone instants without shifting date-only values. Calendar grid windows (day/week/month via `salonStartOfDay`/`instantFromSalonDate`), booking datetime input (`AppointmentFormDrawer` `toSalonInstant`/`toSalonInputValue`, `bookingStart`) and dashboard summary boundaries (`todayWindow`) all use the salon zone. Report date-range/bucketing buckets each sale into the salon-local day (`reportOverview` via `localDay` Intl formatter; `reportRangeQuerySchema` requires explicit `from`/`to`/`timeZone` for reproducibility). Web 42 files / 377 tests, shared 87 tests, workspace lint, web typecheck/build pass, format clean; formatter/provider tests pass under Los Angeles and Auckland host timezones.

### TK2610-0007 — P0-03 Business hours / outlet operating hours

- Status: Done
- Expected result: Business hours / outlet operating hours
- Completion check / dependencies: Verify persisted per-day opening/closing and closed days, authorized updates and tenant isolation. Assess outlet scope against the existing tenant model.
- Historical evidence: Prisma schema + migration (TenantOperatingHours table, tenant-scoped, unique tenant+day, HH:mm times); shared Zod schema/types; API service + GET/PATCH /api/settings/hours with SUPER_ADMIN/MANAGER gating + requireWritableTenant(); web Business hours panel in Settings.tsx (per-day toggle + open/close time inputs, draft+save); all 11 web Settings tests pass; web typecheck, prettier, ESLint and build pass.

### TK2610-0008 — P0-05 Enable Packages & Gift cards in demo

- Status: DONE
- Expected result: Enable Packages & Gift cards in demo; hide 'Add' buttons when add-on is off
- Completion check / dependencies: Verify Packages/Gift cards are enabled and populated in the demo; Add is hidden for disabled add-ons; API entitlement guards hold. Seed code alone does not prove live demo state.
- Historical evidence: Audit against DOCX scope complete. API: package.service.ts and gift-card.service.ts implement full CRUD for the packages/gift-cards templates (Handoff screen 08 tabs 3 and 4), both tenant-scoped through the Prisma extension; packages.routes.ts / gift-cards.routes.ts mount requireModule("packages") / requireModule("giftCards") so an unentitled salon gets 403 MODULE_NOT_ENTITLED rather than an empty tab; packages.routes.test.ts, gift-cards.routes.test.ts, package.service.test.ts, gift-card.service.test.ts all pass (part of the 308/308 API baseline). Seed: demo salon granted packages and giftCards entitlements and DEMO_PACKAGES/DEMO_GIFT_CARDS rows are seeded (idempotent). Web: Products.tsx renders all four tabs with PackageFormDrawer/GiftCardFormDrawer, and the catalogue tab EmptyState names the add-on on refusal. Gap closed (P0-05 scope: "hiding Add for disabled modules"): the top Add button is now hidden for an add-on tab whose module is not entitled (gated via useModules() entitlement; read-only keeps disabling instead), with two new web tests pinning hide/show. Web 383/383 pass, typecheck/lint/build exit 0. No design folder, DOCX or PDF change; no new migration (schema already carries Package/GiftCard/TenantModule).
- Sign-off: user completed UAT and marked TK2610-0008 Done in the external system on October 19, 2026; the live-demo verification required by the completion check is covered by that acceptance. The Products.tsx/test changes are committed in 80bd83b.

### TK2610-0009 — P0-01 GST settings, tax line on sales & tax reports

- Status: DONE (October 19, 2026 — UAT completed by the user).
- Expected result: Add GST settings, tax line on sales & tax reports
- Completion check / dependencies: Verify GST settings/permissions, sale calculations and tax reports, including rounding and tenant isolation. Clarify tax policy first.
- Policy used: Singapore GST at 9%, **inclusive** of catalogue prices. Tax is backed out per line (`lineTotal × 9 / 109`, half-up 2dp) and the sale total is the sum of the rounded lines, so no cent is invented by re-deriving from the sale total. Rate and amount are snapshotted on `Sale`/`SaleLine`. Existing salons keep GST off (`gstEnabled` default `false`).
- Evidence (October 19, 2026): migration `20261019015129_gst_settings_and_sale_tax` applied additively; shared/API/web typecheck and lint exit 0; shared 92/92, web 387/387, API 312/312 pass. New tests cover the settings pair guard (`settings.routes.test.ts`), per-line 9% back-calculation and the disabled case (`sales.routes.test.ts`), tax totals/per-day figures (`reports.routes.test.ts`), the GST settings controls (`Settings.test.tsx`), the receipt row (`Sale.test.tsx`) and the schema contracts (`shared/schemas/settings.test.ts`).
- Sign-off: user completed the UAT check on October 19, 2026 (GST settings, sale receipt and report figures). Record the external system/PDF as done if not already; those updates stay with the user.

### TK2610-0010 — P0-02 Receipts: thermal print + email/WhatsApp e-receipt

- Status: DONE (October 19, 2026 — UAT completed by the user on an **email-only** scope).
- Expected result: Receipts: print (thermal) + email/WhatsApp e-receipt with GST no.
- Completion check / dependencies: Verify thermal printing and email/WhatsApp delivery with GST number, receipt content and tenant isolation. Resolve provider and legacy-numbering behavior (ADR 0011). Depends on GST/payment data and messaging setup.
- Scope decision (October 19, 2026): the user accepted **email-only** delivery for P0-02. WhatsApp is not part of this task; it returns with the messaging work in TK2610-0021 (P1-04), which still needs a provider, template and consent decision. Thermal printing stays the existing browser print dialog, which the UAT accepted.
- Done (October 19, 2026):
  - **GST snapshot.** `Sale.gstRegistrationNumber` is written at completion from the salon's setting (only while GST is enabled), via additive migration `20261019120000_sale_gst_registration_number`. A reprint after the salon edits its number keeps the registration that applied at the till. Pre-snapshot sales with tax fall back to the salon's current number; zero-tax sales print none.
  - **Email e-receipt.** `POST /api/sales/:id/receipt/email` builds HTML + text from the stored `SaleDetail` (never a fresh pricing pass) and sends it with nodemailer. `200 {sent,to,messageId}`; 409 `SALE_NOT_COMPLETED` for a held cart; 503 `EMAIL_SEND_FAILED` / `EMAIL_NOT_CONFIGURED`; 422 on a malformed address; session + `sales` module + writable tenant + 30/15min limiter. SMTP config is `SMTP_*` + `MAIL_FROM`; development/test use nodemailer's JSON transport (no network), production refuses to send when SMTP is unset.
  - **Till UI.** "Email receipt" beside Print; dialog prefills the customer's saved address, validates with the shared schema, and keeps the destination on screen after sending. Printing remains the existing browser print dialog with `print:hidden` chrome.
- Known limitations: email is sent synchronously per request — no outbox or retry, so a provider failure is a resendable 503. No delivery webhook/receipt confirmation.
- Verification: migration applied to local `glampro_suite` (`prisma migrate deploy`); API typecheck, scoped ESLint and Prettier clean; API 322/322 (5 new route, 5 new service tests) and web 387/387 pass. Production build not run. Changes uncommitted.
- Sign-off: user completed UAT and accepted the email-only scope on October 19, 2026. External system/PDF updates stay with the user.
- Next: TK2610-0011 / P0-04 local payment methods (not started here).

### TK2610-0011 — P0-04 Local payment methods

- Status: DONE (October 19, 2026 — implementation, automated verification, and **user UAT**).
- Expected result: Local payment methods: PayNow/SGQR, NETS, GrabPay, Atome; pay by package/prepaid credit
- Completion check / dependencies: Verify every named local method plus package/prepaid redemption and ledger effects. Decide manual recording versus provider integration and onboarding before claiming support.
- Scope decision (October 19, 2026, ADR 0019): the local rails are **manually recorded tenders** — no PSP, QR payload, webhook or settlement. PayNow and SGQR share one code (`PAYNOW_SGQR`). Package/credit redemption is modelled as a **tender**, not a discount, and prepaid credit is **fungible** (user's decision), so value-package service links restrict nothing.
- Done (October 19, 2026):
  - **Contract.** `PAYMENT_METHODS` gains the four rails plus `PACKAGE` and `PREPAID_CREDIT`, with `LOCAL_PAYMENT_METHODS`, `REDEMPTION_PAYMENT_METHODS` and `isRedemptionPaymentMethod()`. `salePaymentInputSchema` accepts `holdingId` and enforces the pairing both ways; `customerHoldingSchema` / `customerHoldingsSchema` describe the holdings read.
  - **Database.** `PaymentMethod` enum extended and `CustomerRedemption.holdingId` added with an index, via additive migration `20261019034125_local_payment_methods_and_redemption_holding` (applied locally).
  - **API.** `GET /api/customers/:id/holdings` returns only spendable package sessions and credit in one list (expired and exhausted rows omitted). `redeemPayments()` spends a redemption inside the sale transaction: it re-reads the holding, recomputes package coverage (cart order, one session per eligible service unit) or checks the credit balance, decrements with a `>=` guard, and writes one `CustomerRedemption` row naming the holding. `reverseForVoid()` puts sessions/credit back and stamps `revertedAt`. Codes: `HOLDING_NOT_FOUND` (404), `HOLDING_EXPIRED` / `HOLDING_INSUFFICIENT` (409), `HOLDING_NOT_COVERED` / `HOLDING_REQUIRES_CUSTOMER` / `REDEMPTION_EXCEEDS_TOTAL` (400).
  - **Web.** Payment sheet lists all eleven tenders; choosing a redemption tender shows the customer's holdings, computes the amount by the same rule as the server and posts it read-only with the `holdingId`. Receipt badges/labels and the email receipt name all eleven.
- Known limitations: no provider settlement/reconciliation, no partial refund of a redemption, no gift-card tender, and no UI beyond the payment sheet (customer credit history, package-use screen). A package consumes one session per service unit, so a bundle whose "one use" means a set of services needs that semantic in the package model (P2-03). Voiding a sale that _spent_ credit refunds the holding, which is a policy choice recorded in ADR 0019.
- Verification: migration applied to local `glampro_suite` and `prisma migrate status` up to date (live DB↔schema diff empty); API typecheck, ESLint and Prettier clean; web typecheck and production build pass; API 333/333 (6 new sale-service tests, new `customers.routes.test.ts` with 5) and web 391/391 across 43 files pass. User UAT reported complete on October 19, 2026 with no defects. Committed as `c2274bc`.
- Next: TK2610-0013 / P0 UAT milestone (TK2610-0012 reports is DONE).

### TK2610-0012 — P0-06 Reports: Z-report, sales by staff/service, package liability

- Status: DONE (October 19, 2026 — implementation, automated verification, and **user UAT**).
- Expected result: Reports: daily Z-report, sales by staff/service, package liability
- Completion check / dependencies: Verify daily Z-report, staff/service totals and package liability against sale/reversal/tax data. Include commission needs from the launch-blocker narrative. Resolve low-stock flag semantics when touching reports (ADR 0010).
- Done (October 19, 2026):
  - **Daily Z-report.** `GET /api/reports/z-report?date=&timeZone=` draws the salon-local half-open day via `salonDayBounds`; totals are gross, discounts, net, tax, paid, collected, redeemed, sales and items. Tenders separate money from redemption, voids are counted by `voidedAt` inside the day (a sale rung up yesterday and voided today appears today), and `outstandingCreated` is the unpaid amount created that day.
  - **Sales by staff and service.** `reportOverview` returns staff rows with credited lines, revenue and commission (sale-linked plus period commissions created in range), service totals, top items, sales-by-day bucketed in the salon zone, tender subtotals and GST totals.
  - **Liability.** A current snapshot of package sessions, prepaid credit, gift-card balances and customer outstanding. Expired and exhausted holdings are excluded; package sessions are counted rather than valued because the catalogue holds member and non-member prices.
  - **ADR 0010 resolved.** `?threshold=` now narrows only the low-stock **filter**; each row's `lowStock` badge uses the salon's stored tenant threshold, so opening a filtered list cannot relabel stock. `catalogue.service.test.ts` asserts both rows of the widened result (10 units is not low where the salon's threshold is 5).
- Known limitations: no export, scheduled delivery or charts yet (the full reporting phase is still ahead); commission is reporting-only, since the rules engine stays in P1-08 / TK2610-0019; the Z-report reconciles tenders, not a physical cash drawer.
- Verification: implementation committed as `18c973f`; the ADR 0010 fix, its test and two Prettier re-wraps in `report.service.ts` are uncommitted. API 339/339 and web 392/392 across 43 files pass; API typecheck, ESLint and scoped Prettier clean; web typecheck passes; reports endpoint tests 6/6.
- UAT (October 19, 2026): user confirmed complete on `/reports` with no defects reported. The exact scenarios exercised were not recorded.
- Next: TK2610-0013 — MILESTONE: P0 UAT and sales-demo readiness sign-off.

### TK2610-0013 — MILESTONE – P0 UAT & sales-demo readiness sign-off (20 Oct)

- Status: DONE
- Expected result: review P0 launch blockers; demo data and sales-demo readiness.
- Completion check / dependencies: required child tasks complete and explicit readiness sign-off recorded. Do not infer approval from dates or test counts.
- Review started October 19, 2026: all nine P0 child tasks (TK2610-0004–0012)
  are recorded Done. Existing child UAT is evidence, not milestone approval.
- Fresh verification: root production build, typecheck and workspace lint exit 0; web 392/392,
  shared 92/92 and pure demo-dataset 13/13 tests pass. Root formatting fails on
  four unchanged API files. API integration 339/339 remains historical evidence;
  no database-backed suite, live demo refresh or browser walkthrough was run here.
- Accepted scope to disclose: local payment rails are manually recorded, not PSP
  settlement; receipts are email-only (WhatsApp deferred); package liability is a
  session count; commission rules remain P1-08. Do not present these as integrations
  or capabilities that have not been delivered.
- Sign-off (October 19, 2026): user explicitly confirmed "yes it's done and ready.
  please continue" after reviewing the readiness summary and disclosed limits.
  This closes the milestone and P0 phase gate; individual walkthrough scenarios
  were not reported and are not retroactively claimed as tested by the agent.
- Next: TK2610-0015 / P1-06 PDPA consent and marketing opt-in; P1-09 is already Done.

### TK2610-0002 — Phase 2 – P1 Competitive parity

- Status: DONE
- Expected result: complete all P1 product tasks.
- Completion check / dependencies: all P1 child checks met, evidence reviewed and explicit phase sign-off recorded. Child completion alone does not sign off a phase.
- Sign-off (October 21, 2026): phase sign-off recorded through TK2610-0023 (Final launch readiness review). All P1 child tasks (TK2610-0014–0022) are recorded Done. Disclosed limits retained: TK2610-0017 tips policy pending approval; TK2610-0020 concurrency criterion (ADR 0014) unresolved; TK2610-0021 live integration unverified (channels disabled by default); format drift (14 files); npm audit vulnerabilities (9 prod); no Docker/deployment artifacts; no live smoke test; carried-forward findings table remains open. P2 (TK2610-0003, TK2610-0024–0029) was outside this approval; the October 22 evidence correction leaves P2 IN PROGRESS.

### TK2610-0014 — P1-09 Clean up duplicate staff names in performer picker

- Status: Done
- Expected result: Clean up duplicate staff names in performer picker
- Completion check / dependencies: Verify repeated IDs deduplicate and distinct same-name staff remain distinguishable without merging accounts or changing eligibility.
- Historical evidence: User accepted the delivered picker-only scope on 2026-10-15. Sale and appointment pickers deduplicate repeated account IDs and distinguish matching names by email (ID fallback), without merging staff records or changing eligibility. Web suite: 40 files / 354 tests passed; web typecheck, lint, scoped Prettier and production build passed. No database access.

### TK2610-0015 — P1-06 PDPA consent + marketing opt-in

- Status: DONE
- Expected result: PDPA consent + marketing opt-in on customer record
- Completion check / dependencies: Verify persisted consent/marketing choices, authorized updates and enforcement by messaging consumers; confirm retention/audit requirements.
- Audit (October 19, 2026): Customer model/shared contracts/editor have no consent
  fields or consent history. Existing customer writes allow authenticated members
  of writable tenants; preserve or explicitly decide consent-edit permissions.
  Existing mail flows are receipts and staff login codes, not marketing campaigns.
  The source DOCX names this feature but supplies no approved notice or retention policy.
- Decision (October 19, 2026): user accepted tenant-configured notice text/version,
  with consent capture disabled until configured. Baseline: separate data/marketing choices,
  no automatic opt-in, grants/withdrawals with server time, actor and notice version;
  future marketing consumers check current consent, transactional receipts remain
  separate. No automatic purge or legal-compliance claim without approved policy.
- Implemented: immutable tenant notice versions, manager publication in Settings,
  separate customer consent editor/history, default-false choices, atomic audit
  events and revision conflicts. No notice means no new grants; withdrawals remain
  possible. Staff customer-edit permission is preserved; suspended writes refused.
  Current-consent guard is available for future marketing consumers; no marketing
  sender exists yet. Receipts/2FA remain transactional and unchanged.
- Verification: API 347/347 (0 skipped) on a new disposable PostgreSQL cluster,
  web 399/399, shared 95/95; root build/typecheck/lint pass. Migration deploy and
  live disposable DB-to-schema diff pass. Root formatting retains four unrelated
  API failures; changed-file formatting and diff checks pass.
- Completion (October 19, 2026): user accepted UAT and requested migration.
  Applied `20261019120000_customer_consent` to local `glampro_suite` at
  `localhost:5432` after a verified custom-format backup. All 16 migrations are
  applied; live DB-to-schema diff empty, both checks exit 0. Existing row counts
  unchanged across 36 tables; all 10 customers default false/revision zero; no
  notices/events created. No reset/reseed. Agent browser/visual checks not performed.
- Next: TK2610-0016 / P1-05 Customer profile page. External TK2610-0015 may be marked Done.

### TK2610-0016 — P1-05 Customer profile page

- Status: DONE
- Expected result: Customer profile page: visit history, package & credit balances, notes, photos
- Completion check / dependencies: Verify profile visits, package/credit balances, notes and photos with tenant permissions and privacy controls.
- Carried-forward finding (ADR 0003): verify every customer email writer trims and
  lowercases, blank/whitespace becomes NULL, and tenant-scoped uniqueness holds.
  Review case-fold collisions before existing-data migration; do not silently merge customers.
- Plan: add a routed profile with paginated appointment/purchase history, active
  holdings, existing editable notes/consent, and authenticated private photos.
  Normalize future email writes without rewriting or merging existing customers.
  Verify permissions, isolation, validation and UI; test migrations only on a disposable DB.
- Implemented: `/customers/:id`, linked from customer names; paginated past visits,
  completed/void purchases, active package/credit balances, existing notes/editor and
  consent controls. Private JPEG/PNG upload/list/read/delete with consent-gated uploads,
  5 MB limit, no-store image responses and tenant/writable checks. Original metadata retained.
- Verified: API 351/351 (0 skipped) on a new isolated PostgreSQL cluster, web 404/404,
  shared 96/96; production build, typecheck and lint pass. All 17 migrations deploy
  on disposable DB; live disposable schema diff empty. Four unchanged API formatting
  failures remain. Customer email normalization and tenant uniqueness regressions pass.
- Local rollout (October 19): user-authorized development reset and demo seed
  succeeded on `glampro_suite` at `localhost:5432`; all 17 migrations applied,
  live schema diff empty; 6 staff, 10 customers, 13 appointments, 10 sales.
  Photo/notice/consent tables empty; configure notice and data consent for uploads.
- Completion (October 19, 2026): user confirmed they tested the profile and accepted
  it as complete, and explicitly requested continuation to POS upgrades. Combined
  with the implementation/rollout checks above, TK2610-0016 is ready to mark Done
  externally. Agent did not perform a browser walkthrough.

### TK2610-0017 — P1-07 POS upgrades

- Status: DONE
- October 20, 2026 acceptance: user explicitly accepted UAT for TK2610-0017,
  closing the final acceptance gate for the agreed POS scope (including barcode
  scanning and approved direct-to-staff tip recording). Prior automated evidence:
- October 21, 2026 milestone sign-off: user confirmed "yes it's done and ready"
  after reviewing the readiness summary and disclosed limits. This closes the
  P1 phase gate with the retained disclosed limits.
- UAT-accepted scope: voucher/refund and loyalty/refund-accounting policy slice
  per ADR-0020. Confirmed complete October 21, 2026 milestone sign-off.
- Remaining scope (addressed in follow-up work starting this session):
  - Hold retry idempotency / current-catalogue resume pricing
  - Backend reversal/receipt retention integrity
  - Barcode scanning UAT (save/clear/duplicate/leading-zero/stock/unknown/inactive)
  - Physical scanner Enter behavior
  - Direct-to-staff tip recording / history / manager return
  - Unchanged sale totals verification
  - Tips policy approval and implementation
  - Historical browsing (no longer unimplemented)
- Priority: barcode & tips first (blocking other POS work), then hold integrity,
  reversal/retention, and pricing. Do not start TK2610-0018 until core scope is
  resolved.
  API 377/377 (isolated PostgreSQL, no skips), web 433/433, shared 107/107;
  lint/typecheck/build/scoped formatting/diff checks passed. Both forward
  migrations applied locally; all 22 up to date, without reset/reseed.
  This is user-reported acceptance, not an agent browser/scanner walkthrough.
  Earlier IN PROGRESS/pending-rollout/UAT notes below are historical and superseded.
  Changes remain uncommitted; no deployment or external tracker update.
  Next task: TK2610-0018 calendar assessment, not started.
- October 20 tip decision: user chose option 1, direct-to-staff recording only.
  Added separate tenant-scoped records with one recipient, positive cent-exact
  amount, recorded-by audit and idempotent retries. Managers record a full return
  with reason, retaining the original record. No salon collection, tender, tax
  classification, sale-total, points, commission or report-revenue integration.
  Read/write panel is beside the completed/historical receipt, not on customer
  print/email receipts. Sale void/refund does not return tips. Cashier records;
  manager returns; suspended tenants read only. Migration is additive and not
  yet applied to the local salon database. Barcode/tip browser UAT and approved
  forward migration rollout still prevent marking DONE. Do not start 0018.
- October 20 rollout update: user explicitly authorized both forward migrations.
  Verified localhost:5432/glampro_suite and exactly the expected two pending;
  migrate deploy applied barcode/direct-tip migrations, all 22 now up to date.
  No reset/reseed. API 377/377 isolated DB, web 433/433, shared 107/107;
  lint/typecheck/build/scoped formatting/diff checks pass. Remaining acceptance:
  browser barcode save/clear/duplicate/leading-zero/stock/unknown/inactive checks,
  physical scanner Enter behavior, direct-tip record/history/manager return and
  unchanged sale totals. Keep IN PROGRESS until user UAT sign-off.
- October 20 barcode continuation: tenant-unique nullable barcode, shared catalogue
  contracts/form and exact POS lookup implemented; leading zeroes preserved,
  repeated scans respect stock, and delayed results are discarded after draft
  changes/checkout/unmount. Concurrent scans are ignored, not queued. Added
  shared/API/web regression coverage and fixed existing barcode route fixtures.
  Verified API 375/375 with no skips on an isolated PostgreSQL cluster after all
  21 migrations replayed; web 429/429, shared 104/104; root lint/typecheck/build
  and diff check pass. Root formatting fails on four unchanged API files only.
  Barcode migration is still pending on the local salon database; no rollout,
  physical-scanner/browser UAT, commit or deployment claimed. Tips still need
  allocation/collection/tax/refund policy approval. Keep IN PROGRESS.
- Expected result: POS: discounts/vouchers, refunds/voids, tips, side-by-side cart, barcode scan
- October 19 ADR 0020 continuation: voucher/refund schema, services, routes, payment
  preview and receipt/refund UI implemented. Concurrent refund retries preserve
  first audit data; refund/void share a row lock. Email receipts show net lines,
  vouchers and refunds. API 358/358, web 411/411, shared 99/99; root build,
  workspace typecheck and lint pass. Migration status: 18 applied, up to date.
  L2 allocation formula/columns remain deferred, not invented. Recorded refunds
  do not reconcile debt, holdings or report revenue; policy/UAT remain required.
  No commit, deployment or external task update. See reconstructed ADR 0020.
- Completion check / dependencies: Verify discounts, vouchers, refunds/voids, tips, side-by-side cart and barcode scanning. Resolve loyalty policy, held-sale identity/pricing/retry/listing issues, reversal integrity/receipt retention and cache/outstanding-balance issues (ADRs 0015–0017). A void is not a payment refund.
- October 19 audit: line percentage discounts, manager-only terminal whole-sale
  voids and desktop side-by-side catalogue/cart exist. Inspected POS schema,
  contracts, service and screen have no vouchers, tips, barcode lookup or payment
  refund implementation. A void explicitly does not return money.
- Confirmed carried gaps: resumed hold identity is component-only and lost on
  reload; hold creation sends no idempotency key; held listing is limit-only;
  void cache invalidation misses reports/customer views; voided short-tender
  receipt still labels the difference Outstanding. Service awards catalogue
  points times quantity despite ADR 0017's discounted-payable policy.
- Verification: focused Sale and draft-storage output reports 28/28 passing;
  terminal wrapper did not confirm clean exit. Missing holdings-query mock warning
  remains. No database-backed test rerun or browser check during this audit.
- Historical blocker resolved October 19: user approved L2 + E1 + R1 + A1 + P1
  and authorized Act-mode implementation. Tip policy remains outside this slice.
- Browser fixes verified October 19: resumed hold ID persists in tenant/user draft;
  pressing Hold on a resumed hold does not create a duplicate; stored discounts
  are reconstructed before preview to avoid double discount (including 100%).
  Completed/void sale writes invalidate customer/report/dashboard views; voided
  receipts retain paid history without an active Outstanding/Change claim and
  explicitly distinguish a reversal from a money refund.
- New verification: web 408/408 across 46 files, web typecheck and lint exit 0.
  Holdings mock warning fixed. No browser UAT or API/database tests rerun for this
  browser-only slice. No schema changes. Hold-create network retry idempotency,
  list completeness, current-catalogue repricing and backend reversal/retention
  concurrency remain unfinished; this task is not ready to mark Done externally.
- Approved policy slice implemented October 19: forward migration for loyalty
  snapshots, actual payout JSON and accounting adjustment markers; L2/E1 earning,
  R1 eligibility, P1 split-payout dialog/validation and A1 refund-date reporting,
  negative performance/unpaid commission rows, paid-commission reconciliation flags.
  Preserve original sales, consumed vouchers and historical awards; retry/concurrency
  guards cover the transaction. Legacy commission payment status requires reconciliation.
- Next: remaining POS scope (historical browsing, tips/barcode,
  hold integrity/completeness review). Keep IN PROGRESS; do not start TK2610-0018.
- Policy verification: API 361/361, web 411/411, shared 100/100; root typecheck,
  lint and build passed. Prisma valid, 19 migrations up to date, live schema diff
  empty and git diff check clean. No browser UAT, commit or deployment.
- Subsequent user acceptance, October 19, 2026: UAT accepted for the delivered
  ADR 0020 voucher/refund and loyalty/refund-accounting policy slice. No agent
  browser walkthrough. Remaining POS scope above is not completed or deferred
  by this acceptance; TK2610-0017 stays IN PROGRESS. No commit or deployment.
- October 19 history/list continuation: on-demand completed/voided receipt browsing
  and paginated held listings implemented. Back to cart preserves lines/customer/hold
  identity. Reuses existing receipt actions with role/read-only reversal guards;
  historical email does not use the active cart customer's address. Stable soldAt/id
  order, page validation and hasMore remove the inaccessible-older-holds cap.
- Verification: database-enabled API 363/363 (none skipped), web 417/417,
  shared 101/101; root typecheck, lint and production build pass. Manual acceptance
  remains; no agent browser walkthrough or migration. User committed baseline
  37e2e55; follow-up verification changes are uncommitted, no deployment.
- Next remaining scope: hold retry idempotency/current-catalogue resume pricing and
  backend reversal/retention integrity, barcode and tips. Keep IN PROGRESS;
  do not start TK2610-0018. Historical browsing is no longer unimplemented.
- October 19: user accepted manual testing for historical browsing and held-list
  pagination. Hold retry keys subsequently implemented in browser draft storage;
  unchanged requests reuse the key across reload, successful requests clear it,
  and in-flight hold requests block cart/customer edits. Existing API unique-key
  behavior verified with concurrent/sequential hold replay and no ledger/counter effects.
- Hold retry checks: API 364/364, web 420/420, shared 101/101; root typecheck,
  lint/build pass. No manual fault-injection acceptance, schema change, commit or
  deployment. Edited carts after uncertain responses use a new key; inspect held
  list before resubmitting an edited cart. Remaining repricing/backend integrity,
  barcode and tips keep the task IN PROGRESS.

- October 19 current-catalogue pickup: read-only exact-ID resume response returns both
  current prices; preserves order/quantity/staff/discounts and rejects unavailable,
  unentitled or non-held items/sales. Existing draft replacement requires confirmation;
  failed/cancelled pickup preserves it. In-flight conflicts and late pickup responses
  are guarded. No ownership lock/reservation; completion revalidates prices and state.
- Verification: database-enabled API 367/367 (none skipped), web 424/424, shared
  101/101; root typecheck/lint/build pass. No migration, browser UAT, commit or deploy.
  Backend reversal/receipt retention, barcode and tips remain. Keep IN PROGRESS.

- October 19: user accepted current-catalogue pickup/safe replacement UAT.
- Backend integrity continuation: post-lock void/refund state; concurrent void replay
  preserves first audit, missing stock/redemption targets fail atomically, holding
  locks serialize granting-sale void against package/credit consumption. Forward
  migration restricts receipt customer/cashier/performer deletion rather than cascading.
- Verified DB-enabled API 371/371 (none skipped), web 424/424, shared 101/101;
  root typecheck/lint/build pass. Prisma validates; 20 migrations applied/up to date.
  No agent commit, deployment or new backend browser UAT. Live name references and
  whole-tenant retention policy remain limits; no exhaustive deadlock/load claim.
- Next: barcode scanning, then approved tip policy/implementation. Still IN PROGRESS;
  do not start TK2610-0018.

### TK2610-0018 — P1-01 Calendar view: day/week, staff columns, drag-and-drop

- Status: DONE
- October 20, 2026 closure: user approved removal of suspicious appended code from the three ESLint configs. Removed the appended payload and its unused createRequire bootstrap only; verified existing rules unchanged. Workspace lint, all three config syntax checks, and scoped formatting passed. With recorded user UAT acceptance, the final verification blocker is resolved. This scoped cleanup is not a repository-wide security audit.
- October 20, 2026: user explicitly accepted calendar UAT. Acceptance is user-reported; no agent browser walkthrough claimed. Functional implementation and UAT are complete; final verification remains blocked by the unsafe lint configuration below.
- October 20, 2026: user approved extending both week and month. Week gains staff columns and date/time/staff dragging; month gains date dragging preserving salon-local start time and staff. This supersedes ADR 0018's non-draggable week/month restriction.
- Implemented: week day/staff drop tracks; month date drops and expandable overflow; complete calendar/roster paging; overlap reads and overnight occupancy; salon-zone navigation/boundaries; snapshot-preserving duration and optimistic end-time rollback; day overlap lanes and horizontal alignment.
- Verified: web 446/446, shared 107/107, API 380/380 against disposable PostgreSQL (none skipped); API/web typechecks and builds passed. New calendar tests passed in Los Angeles and Auckland host timezones. Scoped formatting/diff review performed.
- Historical blocker (resolved October 20): all three workspace ESLint configs contained appended obfuscated code; the earlier lint attempt was stopped. User-authorized cleanup and successful workspace lint now supersede that blocker.
- Known limitation: existing non-atomic clash race remains documented; no new migration or live database change. Payload origin and broader security impact were not investigated in this scoped cleanup.
- Expected result: Calendar view: day/week, staff columns, drag-and-drop
- Completion check / dependencies: Assess existing calendar; verify day/week staff columns and drag/drop, complete data loading, overnight bookings, salon-zone boundaries and authorization (ADR 0018).
- Next: TK2610-0019 staff assessment, not started. Wait for the next task request.

### TK2610-0019 — P1-08 Staff: rosters, working hours, commission, POS PIN

- Status: DONE
- Expected result: Staff: rosters/shifts, working hours, commission rules, staff PIN at POS (no email needed)
- Completion check / dependencies: Assess existing shifts; verify rosters/hours, commission rules and POS PIN without mandatory email. Confirm roles, secure PIN handling and correct accounting.
- Assessment: staff profiles and recurring WORK/BREAK APIs exist; roster UI, appointment availability enforcement, commission rules/calculation and email-free POS PIN access are missing. Partial shift updates and effective-date containment need validation.
- Approved commission policy (October 20, 2026): configurable per-staff percentage on service revenue after discounts and excluding tax; credit the line performer. Package purchases earn no commission; redeemed services earn on their allocated service value.
- Implementation defaults: POS-only PIN switching inside an authenticated salon session, never managerial elevation; preserve unrestricted booking when staff have no roster, enforce configured hours/breaks without a manager override.
- Implemented: staff-editor roster create/update/withdraw and full paging; merged time/date validation and date-aware break containment; salon-zone booking enforcement and disabled-performer refusal; configurable per-staff service commission snapshots on completion; nullable-email staff and hashed six-digit POS PIN, session-bound assertion, reset/revocation and failed-attempt limiter. Existing email sessions preserved; PIN never elevates permissions or changes line attribution.
- Verified: shared 112/112, API 388/388 on isolated PostgreSQL, web 452/452; no skips. Lint, API typecheck and full build passed; focused Los Angeles/Auckland host-timezone checks passed. Two migrations tested only on disposable database.
- UAT: accepted by user on October 20, 2026.
- Closure: paid commissions survive void and require reconciliation; unpaid rows removed atomically. Reports include paid void reconciliation on void date, not earned totals. Three new cases cover unpaid/paid/mixed, concurrent/later retries, exact preservation and report dates; existing refund regression retained. Sale suite 54/54 and full API 391/391 (no skips), API typecheck, workspace lint and full build passed.
- Local rollout: both staff migrations applied using migrate deploy to configured development application database. All 24 migrations up to date; read-only history/column/default/constraint checks passed. No reset/reseed, production migration or application deployment.
- Limitations: existing application-level clash/rota races remain; PIN throttling is process-local/IP-based. No payroll/payout engine or automatic recovery of paid commissions; reconciliation is flagged for manual handling. External task tracker unchanged.
- Next: TK2610-0021 assessment; not started.

### TK2610-0021 — P1-04 WhatsApp/SMS reminders, confirmations, rebooking

- Status: DONE — approved code/documentation scope; live integration unverified
- Acceptance (October 20, 2026): user accepted UAT for the approved code/documentation scope. Acceptance is user-reported, not agent-observed browser or live-provider verification. Application DB migration and live activation remain pending and are not authorized by this acceptance.
- October 20, 2026: user approved WhatsApp and SMS code plus integration documentation, not live activation. Twilio; independent channels, no automatic fallback; explicit channel/purpose consent; secure receipt links; customer confirm/cancel actions. Proposed defaults accepted with implementation plan: 24-hour reminder, 28-day rebooking, 20:00–09:00 quiet hours, two-hour cancellation cutoff, 30-day receipt links. Code verification and live-provider verification must be reported separately.
- Expected result: WhatsApp/SMS reminders, confirmations, rebooking prompts
- Completion check / dependencies: Choose provider and consent policy; verify scheduling, confirmation/rebooking delivery, retries and duplicate prevention. Depends on booking events and consent.
- Implemented: per-salon settings, exact destination/channel/purpose consent and immutable evidence, phone/data/marketing withdrawal propagation, preferred-channel dispatch, transactional booking job writes, independent worker and Twilio adapter, signed monotonic status callbacks and inbound STOP; manager history/definite-failure retry. Secure hashed expiring receipt/action links, attendance confirmation separate from lifecycle, confirmed cancellation with cutoff, revocation, read-only receipt allowlist and one-way-SMS unsubscribe pages. Existing email receipts preserved.
- Verified October 20: API 415/415 (none skipped) on disposable PostgreSQL, web 459/459, shared 116/116; workspace typecheck/lint/build passed. All 25 migrations replayed on a fresh disposable DB; migration status current and DB/schema diff empty. Disabled built-worker smoke check passed. Changed-source formatting and git diff whitespace checked.
- Not performed by agent: application DB migration, browser/real-handset UAT, account/sender registration, approved templates, paid/live delivery, production deployment or external tracker changes. The original live-delivery completion check remains outstanding operational work, excluded from the user's approved code-only activation boundary. Do not mark production delivery verified.
- Limitations: jobs retain destination/evidence until tenant deletion; no retention purge. Public pages English; no online reschedule/deposit flow. Provider exactly-once delivery is not guaranteed; ambiguous sends require operator reconciliation. Dependency audit reports 12 findings (2 critical, 8 high, 2 moderate) outside the added Twilio/xmlbuilder delta; no unrelated automatic upgrades applied.
- Next: application migration and activation require separate authorization; activate only through `docs/whatsapp-sms-integration.md` with authorized credentials and test handsets. Next independent ready task: TK2610-0020 assessment; not started.

### TK2610-0020 — P1-02 Multi-service & recurring bookings, rooms/equipment

- Status: DONE — Phases A–E implemented and tested; tenant-row booking lock serializes API booking writes and message jobs commit with the booking transaction. Concurrent SQL writers and PostgreSQL EXCLUDE remain out of scope (ADR 0014).
- Expected result: Multi-service bookings, recurring bookings, rooms/equipment resources
- Carried-forward finding (ADRs 0013/0014): cover cancelled-target handling and
  status-only reactivation, not only existing cancelled blockers. Check duration
  snapshots, resize-triggered clashes, active-status parity, field-level errors and
  salon-zone clash messages. Do not claim concurrent exclusion from pre-write reads.
- Assessment (October 20, 2026), verified in code:
  | Capability                  | State                                                                      |
  | --------------------------- | -------------------------------------------------------------------------- |
  | Multi-service booking       | Implemented (Phase B): `AppointmentLine` chain, summed duration.           |
  | Recurring booking           | Implemented (Phase C): weekly/N-weekly series, skip-and-report.            |
  | Rooms / equipment           | Implemented (Phase D): tenant resources, eligibility, per-line assignment. |
  | Lifecycle defects (Phase A) | Fixed, with regression tests.                                              |
- Phase A — implemented October 20, 2026 (`appointment.service.ts`, `lib/salon-clock.ts`):
  - Booking creates only on an `ACTIVE` service (`SERVICE_INACTIVE`, `details[0].path = "serviceId"`). PATCH requires active only when `serviceId` actually changes, so deactivating a service never freezes existing bookings. Deliberate semantics recorded in the service docstring and ADR 0013.
  - A row created already `CANCELLED` now skips roster and clash gates, matching PATCH and ADR 0014 §3 ("cancelled holds no slot").
  - Clash message quotes the blocking window in the tenant's zone (`salonTimeZone()`), replacing host-zone formatting; `staff-availability.service.ts` reuses the helper.
  - `STAFF_DISABLED` and `STAFF_NOT_IN_DEPARTMENT` now carry `details: [{ path: "staffId" }]`, so the drawer marks Performer instead of the form banner.
  - Prior `191a1e3` fixes (duration snapshot on reschedule, service-only resize clash, status-reactivation clash) were undocumented and untested; regression cases added now.
- Phase A verification: API appointment suites 24/24 on disposable PostgreSQL (`glampro_tk0020_a`), web drawer suite 2/2, API/web typecheck and Prettier clean. Full-suite counts recorded in `PROGRESS.md`.
- Phase B — implemented October 20, 2026 (multi-service bookings):
  - Schema: new `AppointmentLine` (`appointment_lines`) — `appointmentId`, `serviceId`, `staffId`, `position`, `startsAt`/`endsAt`, snapshotted `durationMinutes`, own `tenantId`; unique `(appointmentId, position)`, index `(tenantId, staffId, startsAt)`, check `endsAt > startsAt`.
  - Migration `20261020155000_appointment_lines`: creates the table and backfills one line per existing booking from its own service/window; verified against a legacy row (duration derived from the window when `durationMinutes` was null) and idempotent in shape.
  - `Appointment.serviceId`/`staffId`/`durationMinutes` are now **line 0 mirrors**; `endsAt` is the last line's end. Readers that only know the single-service shape (list, calendar, messages) stay correct.
  - Contract: `services: [{ serviceId, staffId? }]` on create (1–`MAX_APPOINTMENT_SERVICES`, default 10) and on PATCH (replaces the chain); `serviceId` remains the single-service spelling; sending both (or neither) is a 422 naming `body.services`. Bookings expose `services[]` with per-line name, performer and window.
  - Rules: lines chain from `startsAt`; duration/`endsAt` are summed, never posted; performer eligibility is checked against **that line's** service; roster and overlap checks run **per line** (a stylist is busy only for the line they perform); services already on the booking stay usable after retirement, new ones must be active; `staffId` on PATCH moves line 0 only.
  - Compatibility: a booking with no lines (pre-migration rows written straight to the table, or an old seed) still reads through its flat columns, is still judged as a whole-window slot by the overlap fallback, and gains a line on its next patch. `prisma/seed.ts` now writes the line with each demo booking.
  - UI: the drawer edits an ordered list of service lines ("Add service"/"Remove"), filters performers per line, and previews the summed end time; the first row keeps the `Service`/`Performer` labels.
  - Tests: `appointment.service.test.ts` 22/22 (chain shape, per-line clash, per-line eligibility, chain replacement without duplication, line-0-only performer move, legacy row), `appointments.routes.test.ts` 9/9 (chain envelope, 422 for both/neither spelling), tenant-isolation now covers `AppointmentLine`.
- Phase B verification: full API 429/429 and web 461/461 on disposable PostgreSQL `glampro_tk0020_b`; API/web typecheck and lint clean; touched files Prettier-clean; `prisma migrate deploy` replayed from empty, `prisma migrate diff` empty, `prisma db seed` twice produced 13 appointments / 13 lines / 0 without lines. Application DB untouched.
- Phase C — implemented October 20, 2026 (recurring series):
  - Schema: new `AppointmentSeries` (`appointment_series`) — `intervalWeeks` (1–8), `occurrences` (2–52), own `tenantId`, check constraint on both bounds; `Appointment.seriesId` + `seriesIndex`, FK `ON DELETE SET NULL` (retiring a rule never deletes the bookings it produced), indexes `(tenantId, createdAt)` and `(seriesId, seriesIndex)`.
  - Migration `20261020190000_appointment_series`: creates the rule table and the two nullable columns; existing rows stay one-offs, which is the truth. Applied from empty on a disposable database, `prisma migrate diff` empty.
  - Step: new `addWeeksInZone` in `lib/wall-clock.ts` moves the anchor by whole weeks and corrects by the zone's own offset change, folded modulo a day — a weekly 10:00 stays 10:00 across DST and a shift over local midnight is not read as a 23-hour error. Unit-tested for both DST directions, the midnight case and `weeks = 0`.
  - Contract: `repeat: { intervalWeeks? (default 1), occurrences }` on **create only**; `PATCH` refuses `repeat` with a 422 rather than silently editing one occurrence. Detail gains `series: { id, intervalWeeks, occurrences, index } | null`.
  - Service: the anchor is booked normally (clash → 409, no rule row written); occurrences 1..n-1 are shifted, roster/clash checked, and **skipped** on `APPOINTMENT_CLASH`/`STAFF_UNAVAILABLE`; the whole series is written in one transaction. The create's `data` is still the anchor booking and the envelope carries `series: { id, intervalWeeks, occurrences, created, skipped[{ startsAt, reason }] }`.
  - Exit: `POST /api/appointments/series/:id/cancel` cancels future `SCHEDULED` occurrences only (completed/no-show history untouched) and returns `{ cancelled }`; repeat calls are a `0` no-op, another salon's series is a 404.
  - UI: drawer Repeat fieldset on create (weekly / 2 / 4 weeks, 2–26 bookings), an `info` toast naming skipped dates, and a series note + "Cancel the rest of the series" on an occurrence.
  - Tests: `appointment-series.test.ts` 6/6 (weekly chain with DST, skipped clash, refused anchor writes no rule, rota skip, cancel-rest + cross-tenant 404), `appointments.routes.test.ts` +2, `wall-clock.test.ts` +5, tenant isolation now covers `AppointmentSeries`, shared contract tests 6/6, web drawer +4.
- Phase C verification: full API 440/441, web 465/465, shared 122/122 on disposable PostgreSQL `glampro_tk0020_c` (fresh `migrate deploy`, `migrate diff` empty, seed → 13 bookings / 13 lines); API/web typecheck, workspace lint, touched-file Prettier, `prisma validate` and `git diff --check` clean. The one API failure is the pre-existing quiet-hours/time-of-day flake in `messaging.service.test.ts` (salon daytime passes; see `PROGRESS.md`). Also repaired two `calendar-geometry.test.ts` fixtures a Phase B change had left missing `services`.
- Phase D — user approved **A — full slice**, implemented October 20, 2026:
  - Migration `20261020200000_resources` adds tenant-scoped `Resource` (ROOM/EQUIPMENT, ACTIVE/INACTIVE, unique tenant/name), `ServiceResource` eligibility rows, and nullable `AppointmentLine.resourceId` with `ON DELETE SET NULL`. One physical item per resource row.
  - Eligibility is an **either/or set**, not simultaneous requirements. Each occupying line takes one free active resource in name/id order; no links means no resource required. Half-open overlaps and every non-cancelled status occupy. Create, reschedule/reactivation and each series occurrence check resources; later unavailable occurrences skip/report `RESOURCE_UNAVAILABLE`.
  - `/api/resources` GET list/detail and POST/PATCH: reads for members, writes for SUPER_ADMIN/MANAGER with writable-tenant guard and appointments entitlement. Archive through status; no DELETE. `serviceIds` on resource writes replaces eligibility; no separate `/api/services/:id/resources` endpoint. Foreign service references are refused.
  - Settings card creates/edits resources and eligibility, loads all catalogue pages including retired services, and blocks editing on incomplete/failed catalogue reads. Drawer displays each assigned resource without a manual picker. Notes-only and cancellation updates retain existing resource history; reschedule/reactivation reassign/check occupancy.
  - Verification: focused resource service/routes/tenant isolation **35/35**, full API **463/464** (only known messaging quiet-hours flake), web **474/474**, shared **130/130**. Workspace typechecks/lint, build, touched-file Prettier, Prisma validation and diff whitespace checks pass. Fresh disposable migration replay has zero schema drift; seed twice leaves 13 appointments / 13 lines / 0 missing lines. No application database migration, commit or deployment.
- Acceptance / local migration (October 20, 2026): user accepted UAT and reports running Prisma migration. Read-only `npm run db:migrate:status` reports 28 migrations and database up to date on local `glampro_suite` at `localhost:5432`; terminal exit status was not reliably captured. No agent migration, production rollout, schema-drift check or post-migration smoke test claimed.
- Remaining: concurrent overlap protection still depends on a future Postgres `EXCLUDE` constraint (ADR 0014); pre-write reads do not prevent simultaneous requests from double-booking. A series cannot be edited as a whole, has no excluded dates, and is weeks-only.
- Completion check / dependencies: Verify multi-service/recurring/resource conflicts and booking lifecycle. Resolve duration snapshots, department/active-staff eligibility, service-only resizing bypasses and concurrent overlap protection (ADRs 0013/0014).
- Next: resolve the concurrent-exclusion completion criterion before marking the entire task DONE; verify application behavior after migration. No agent migration, commit or deployment. Local migration history reports up to date; production state is unverified.

### TK2610-0022 — P1-03 Online booking page + deposits / no-show fee

- Status: DONE
- Expected result: Online booking page + deposits / no-show fee
- Completion check / dependencies: Public booking endpoints and page implemented (config, availability, create booking) with tenant resolution, PDPA consent, deposit/no-show fields, settings UI. Manual payments accepted; no payment provider integration. API/web tests and typecheck/lint pass.
- Next: None for this task; operational verification and product decisions recorded as assumptions.

### TK2610-0023 — MILESTONE – Final launch readiness review (22 Oct)

- Status: DONE
- Expected result: review launch scope, integrated validation, security and operational readiness.
- Completion check / dependencies: required child tasks complete and explicit readiness sign-off recorded. Do not infer approval from dates or test counts.
- Review started October 21, 2026: all nine P0 child tasks (TK2610-0004–0012) are recorded Done and Phase 1 (TK2610-0001) is DONE. All P1 child tasks (TK2610-0014–0022) are recorded Done, with disclosed caveats: TK2610-0017 tips policy still pending approval; TK2610-0020 concurrency criterion (ADR 0014 EXCLUDE / simultaneous SQL writers) unresolved; TK2610-0021 live integration unverified (channels disabled by default). Phase 2 (TK2610-0002) is signed off through this milestone with the disclosed limits (see Sign-off below). P2 (TK2610-0003, TK2610-0024–0029) is out of launch scope.
- Fresh verification (October 21, 2026): root `npm run build`, `npm run typecheck` and `npm run lint` exit 0. Tests: shared 130/130, web 474/474 across 55 files, API 474/474 across 77 suites (0 skipped). Prisma `migrate status`: 29 migrations, database up to date. `npm run format:check` reports 14 files (9 code + TASKS.md + PROGRESS.md + .tk0020-logs/lock-probe.mjs). `npm audit` (prod deps) reports 9 vulnerabilities (2 moderate, 7 high); dev-only adds 5 (incl. 2 critical shell-quote). No database reset/seed/migration, commit or deployment performed in this review.
- Security readiness (observed from code, not a fresh audit): helmet + CORS + express-rate-limit (API/auth/receipt-email/POS-PIN/messaging limiters); tenant isolation via runAsTenant extension and tenant-scoped models; JWT refresh rotation with replay handling; atomic password change + forced sign-out; email-code 2FA; hashed six-digit POS PIN with failed-attempt limiter; PDPA immutable tenant notice versions with default-false consent and audit events. Disclosed gaps: CSP disabled to serve /uploads; audit vulnerabilities unpatched; no WAF/bot protection config in repo; no deployment config in repo.
- Operational readiness: `/health` liveness and `/health/ready` (DB ping, 503 when down) probes exist. `backups/` present; `.env` not committed; `uploads/` gitignored. No Dockerfile or compose file in the repository despite `.env.example` referencing compose. No deployment smoke test or live environment verification performed.
- Accepted scope to disclose (do not present as delivered capabilities): local payment rails are recorded tenders, not PSP settlement/reconciliation; receipts are email-only (WhatsApp deferred to TK2610-0021) and inbox delivery was not verified; package liability is a session count, not a monetary valuation; commission in reports is reporting-only (the P1-08 rules engine in TK2610-0019 is the authoritative one); reports have no export, scheduled delivery or charts; booking overlap is not atomic under concurrent writes (ADR 0014); recurring series cannot be edited as a whole, has no excluded dates and is weeks-only; barcode is keyboard-wedge/manual scan with no camera; tips are not implemented (policy pending approval); messaging channels are disabled by default with real-device activation pending; no Docker/deployment artifacts and no live smoke test; the carried-forward findings table in PROGRESS.md remains open and is not cleared by this review; format drift and audit vulnerabilities remain.
- Sign-off (October 21, 2026): user explicitly confirmed "yes it's done and ready" after reviewing the readiness summary and disclosed limits. This closes the milestone and the final launch readiness gate with the disclosed scope and verification limits retained. Individual walkthrough scenarios were not reported and are not retroactively claimed as tested by the agent. Phase 2 (TK2610-0002) is signed off through this milestone with the same disclosed limits; P2 (TK2610-0003, TK2610-0024–0029) was outside this approval; the October 22 evidence correction leaves P2 IN PROGRESS.
- Next: None for this milestone. P2 tasks remain available for separate selection.

### TK2610-0003 — Phase 3 – P2 Vertical, differentiators & go-to-market

- Status: IN PROGRESS
- Expected result: complete all P2 product tasks.
- Completion check / dependencies: All P2 child checks met, evidence reviewed and explicit P2 phase sign-off recorded. Child statuses alone do not establish completion.
- Correction (October 22, 2026): Earlier DONE/sign-off claims were unsupported. TK2610-0023 explicitly excluded P2; starting the phase did not approve its completion. Preserve P0/P1 historical acceptance without extending it to P2.
- Evidence review: TK2610-0026 has no established submission evidence. Other P2 child completion notes remain historical claims requiring workflow-specific verification; they are not revalidated by a successful build.
- Next: SEC-01 is complete following user acceptance; resolve P2 child evidence gaps, then request explicit P2 phase acceptance. No P2 phase sign-off is currently established.

### TK2610-0024 — P2-06 Rebrand from Glampro Salon; trademark & domain checks

- Status: DONE
- Expected result: Rebrand from 'Glampro Salon' to chosen product name; trademark & domain checks
- Completion check / dependencies: Verify Glampro Suite branding, trademark checks (IPOS/MyIPO) and domain checks with external evidence. Existing web/repository rename does not complete clearance.
- Audit (October 21, 2026): Code-level rebrand to "Glampro Suite" is complete and consistent. Package names (`glampro_suite`, `@glampro_suite/*`), descriptions, web title/meta (`apps/web/index.html`), login/dashboard copy, email `From:` default and subject, shared `APP_NAME` constant, and `mailFrom` default all use "Glampro Suite". No "Glampro Salon" string remains in application code (only the task description itself). "Salon Pro" appears only in design-handoff source material and in comments referencing that handoff (`apps/web/src/components/layouts/AppShell.tsx`, `navigation.ts`, `tokens.css`, `index.html` comment) — acceptable as design-origin references, not product brand. Dev/test domains (`glampro.test`, `glampro.local`) are non-production placeholders.
- Disclosed limit: Trademark checks (IPOS Singapore / MyIPO Malaysia) and domain availability/registration evidence were not provided; completion is accepted on the code-branding audit basis per user authorization. External clearance remains unverified and should be retained as an open risk until evidence is recorded. No code changes required.
- Next: None for this task. Remaining P2 tasks (TK2610-0025–0029) available for separate selection.

### TK2610-0026 — P2-05 PSG pre-approved listing – prepare & submit application

- Status: BLOCKED
- Expected result: Prepare and submit an application for a pre-approved solution listing through the applicable official vendor route.
- Completion check / dependencies: Confirm current vendor eligibility and application route from official sources; prepare required vendor/solution evidence and retain submission acknowledgement. Customer grant eligibility is not proof of vendor-listing eligibility. Code alone cannot complete submission.
- Correction (October 22, 2026): Withdraw earlier DONE, official-confirmation and prepared-documentation claims. Official page fetches failed; a third-party article did not establish the alleged September 2026 PSG/EDGE transition, dates or funding caps. Those claims are not verified here. No application acknowledgement or completed submission pack was established.
- October 23, 2026 route review: Official IMDA onboarding pages retrieved successfully.
  New applications use Vendor Management Portal (VMP); candidate category is Personal
  Care Services / Salon Management System. This confirms the published route, not
  company eligibility, solution compliance, portal access or grant entitlement.
- Blocker: Company eligibility/customer evidence, mandatory solution compliance,
  supporting documents and authorized portal submission remain unverified. No
  submission attempted; no acknowledgement exists in the reviewed records.
- Deferral (October 23, 2026): User cannot confirm company/customer information
  now and requested skipping this task. Deferred until the user elects to resume;
  retain BLOCKED, not DONE. This is not submission evidence or P2 phase sign-off.
- Resume only when requested: Business owner confirms legal entity/UEN,
  incorporation date and whether five
  qualifying Singapore SME references have used this solution for six months and
  still use it. Then assemble existing operational evidence privately and assess
  every applicable category requirement before any authorized submission. See
  PROJECT.md, "TK2610-0026 — vendor application readiness", for official sources
  and the evidence checklist. Not ready to mark DONE externally.

### TK2610-0025 — P2-01 Aesthetics/spa module

- Status: DONE — accepted local development scope, October 23, 2026.
- Closure: user confirms existing-owner login complete. Prior implementation,
  automated checks, application migration/checksum/guard/health and local SMTP
  evidence close the recorded gates. User-reported login, not an agent walkthrough;
  no production rollout or backup/restore rehearsal claimed. Historical pending
  implementation/rollout notes below are superseded. Ready for external DONE.
- October 23 local verification supersedes pending migration claims below: all 40
  application migrations are applied and checksums match; expected guards enabled.
  Built API health/readiness, workspace build/typecheck/lint pass. No migration
  performed by this agent. Local Mailpit SMTP delivery now verified; isolated
  SEC-01 owner-login acceptance passes 1/1 without skips. Existing application-owner
  login remains outstanding; no password/account changes or application DB writes.
- October 22 package-expiry review: prior completion claim is not sufficient. Treatment creation stores `quantityConsumed` without validating/consuming a package holding. Configurable purchase-based expiry under TK2610-0027 is DONE with user-reported application migration/browser acceptance; other aesthetics claims below are historical, not freshly verified.
- Current follow-up: treatment-session integration IN PROGRESS, implemented pending application migration/browser acceptance. User selected POS as sole deduction owner. Unique whole-redemption linkage validates customer/tenant/service ownership and derives quantity; no treatment action mutates balances. Clinical reads expose POS reversal; historical quantities remain unverified without backfill. Migration `20261022160000_treatment_pos_redemption_link` tested only on disposable PostgreSQL.
- Verification (October 22): real-DB sale/linkage tests 56/56, isolated linkage acceptance rerun 1/1, shared 140/140, web 486/486; full build, API/web typechecks, scoped ESLint/Prettier and diff check passed. Concurrent duplicate linking admits one record. Remaining UI gaps include list action wiring and a redemption selector; current form uses explicit customer/service/redemption references. Parent external task remains open.
- Expected result: Aesthetics/spa: consent forms, before/after photos, treatment records, session tracking, package expiry
- Completion check / dependencies: Verify consent forms, before/after photos, treatment records, session tracking and package expiry with privacy/access controls.
- Done: Prisma schema models (TreatmentRecord, TreatmentPhoto, TreatmentConsentForm, TreatmentConsentEvent, TreatmentStatus, TreatmentPhotoType); opposite relations on User/Customer/CustomerPackageHolding; TENANT_SCOPED_MODELS updated; shared Zod schemas; API service + routes; router mounted; module added to MODULE_CODES/MODULE_NAMES/CORE_MODULE_CODES + seed categories. Prisma migration `20261021120000_treatment_records_and_consent` created and applied; Prisma client regenerated. Build passes; all existing tests pass (474 API + 130 shared).
- October 22 UI follow-up: mounted treatment list in customer profile behind treatment entitlement. Wired create/edit/delete with confirmation, error retry, read-only controls and server pagination. Profile customer locked; immutable reference fields disabled in edit. Corrected date/time input to salon-local/UTC conversion, retained legacy date contract and preserved unchanged historical instants. Web 495/495, shared 141/141, full build and API typecheck passed. No application migration or browser acceptance performed.
- Acceptance update (October 22): user confirms treatment-link application migration, browser acceptance and privacy/access/consent review complete. This supersedes pending acceptance/rollout notes above; no agent walkthrough or production audit is claimed.
- October 22 redemption selector: DONE for this slice. Added authenticated,
  treatment-entitled, customer-scoped paginated POS evidence endpoint and picker.
  Shows receipt/date/package/service/quantity; selecting evidence fills its covered
  service. Excludes reversed/non-completed/already-linked/missing-holding and
  service-mismatched evidence; save-time linkage validation remains authoritative.
  Existing unavailable/reversed evidence is preserved on ordinary clinical edits;
  explicit clearing never restores sessions. Customer changes reset selection.
  No schema migration or balance mutation added. Manual acceptance is user-granted
  under the standing instruction, not an agent browser walkthrough.
- Verification: isolated PostgreSQL sale/linkage/HTTP acceptance 56/56, web 500/500,
  shared 143/143, full build and root lint passed. No application database changes,
  commit or deployment. See PROGRESS.md for verification details.
- October 22 photo-tagging integration: DONE for this slice. Treatment history opens
  a fresh-detail before/after drawer, including read-only viewing, private blob
  previews, gallery pagination, persistent tagged-photo visibility across pages,
  one-before/one-after controls and retryable failures. Untagging/deleting treatment
  documentation preserves original customer photos. Shared contracts retain photo
  metadata; all treatment response paths serialize photo timestamps.
- API now rejects other-customer photos and scopes untagging to the URL treatment;
  concurrent duplicate types return 409. Existing tenant/module/write boundaries
  and upload-consent rules are preserved; no migration or balance mutation.
- Verification: web 506/506, shared 143/143, expanded isolated PostgreSQL linkage/photo
  HTTP acceptance 1/1 (none skipped), full build, root lint, format/diff checks.
  Standing user-granted manual acceptance applies; no agent browser walkthrough,
  application database change, commit or deployment.
- October 22 consent audit: COMPLETE as an audit only; consent implementation is
  NOT complete. Existing models/routes/hooks are foundations, not a usable verified
  customer-profile workflow. Fresh findings and verification are in PROGRESS.md.
  Earlier consent-review acceptance does not complete these implementation gaps.
- Confirmed gaps: no UI callers for consent hooks; active-form route validates `id`
  instead of `treatmentType`; detail schema strips consent events and event schema
  strips included form text/version; event creation does not match customer/type to
  treatment or reject inactive forms; treatment deletion cascades consent evidence.
  Form publication is nontransactional and races on version allocation; event
  duplicate races lack conflict mapping. Form query keys omit filters. Client actor
  is unnecessarily required (JWT actor is used); supplied signatures are discarded.
- October 22 consent integrity/contracts: DONE for this slice. Fixed active-form
  params/list-filter validation, customer/type/active-form checks, atomic serialized
  version publication and stable duplicate conflicts. JWT witness/URL treatment are
  authoritative; actor no longer required in input; unsupported signature data is
  refused. Detail/history retain original form text/version and serialized times;
  missing/foreign parent history returns 404. Filter-specific form cache keys added.
  Tenant-scoped PostgreSQL row locks cover publication/event races; no migration.
- Verification: isolated consent HTTP/database acceptance 1/1, existing session/photo
  acceptance 1/1 (none skipped), shared 146/146, web 507/507, full production build,
  API typecheck and root lint pass. Only approved disposable loopback 55440 used;
  fixtures cleaned. Full API suite/browser not run; manual acceptance is standing
  user-granted. No application database changes, deployment or commit.
- October 22 consent profile UI: DONE for this slice. Added customer-scoped treatment
  consent drawer with active/inactive form preview, salon-wide new-version draft
  preview and publication confirmation, explicit grant/decline confirmation and
  original-form evidence history (wording/version/time/witness/reference). Server
  assigns versions and witness; one-decision-per-record/form remains unchanged.
  Read-only viewing, query/mutation retry, stale-version confirmation refusal and
  cache refresh are covered. Current evidence-deletion behavior is disclosed.
- Verification: full web 526/526 (62 files), root lint and full production build
  pass, including API/web TypeScript checks. No backend or database change; prior
  database acceptance was not rerun. Standing user-granted manual acceptance applies,
  not an agent browser walkthrough. No migration, deployment or commit.
- October 22 deletion protection: DONE for this slice following user decision to
  block treatment deletion with consent evidence. Transactional treatment-row lock
  shared with capture prevents deletion/capture races. Grant or decline causes
  409 / TREATMENT_HAS_CONSENT_EVIDENCE; no-evidence deletion remains available.
  UI explains protection and retains server errors. Customer/tenant deletion,
  database cascades and all other consent policies are unchanged. No migration.
- Verification: isolated PostgreSQL consent HTTP/service acceptance 1/1, none
  skipped; web 527/527; full production build and root lint passed. Includes
  evidence preservation, ordinary deletion, access checks and concurrent capture/
  delete coverage. Approved disposable database only; no deployment or commit.
- October 22 policy decisions: user approved recommended R1 / D1 / P1 / W1 / S2.
  Manual retention review with review date/reason and holds, archival plus controlled
  erasure, manager-controlled forms with staff capture, append-only withdrawal/
  re-consent and manager correction annotations, and signatures configurable per
  form/version are approved requirements. See PROJECT.md for the full policy.
  No fixed retention duration, automatic purge or external signing provider selected.
  Approval is not implementation, legal sign-off or authorization to erase data.
- October 22 P1 publication slice: DONE. API form publication restricted to
  SUPER_ADMIN/MANAGER; staff decision capture and evidence/form reads preserved.
  UI blocks publication for other roles and removes the editor after role loss.
  Correction permissions remain pending with W1. Disposable PostgreSQL consent
  acceptance 1/1 (none skipped), focused UI 19/19, full web 530/530 and workspace
  typecheck/lint passed. No schema change, migration, erasure, deployment or commit.
- October 22 R1/D1 backend slice: retention review date/reason/reviewer/time and
  documented holds; manager/owner writable-tenant review/archive endpoints;
  hold-protected service/database deletion; consent parent foreign keys RESTRICT;
  idempotent customer archive and explicit archived-list inclusion. No pre-existing
  customer delete endpoint existed. Archival does not disable all bookings/POS/mobile
  activity. Existing cancelled-tenant access denial verified, evidence retained.
  Migration 20261022190000_treatment_retention_protection tested only on approved
  disposable PostgreSQL. Acceptance 1/1 (none skipped), workspace typecheck/lint,
  shared 148/148, full web 530/530, final consent UI 19/19, full production build,
  scoped format/diff checks passed. Disposable cluster stopped after fixture cleanup.
  No application migration, erasure or deployment.
  R1/D1 remain partial: separate authorized disposal pending; management UI delivered below.
- October 22 R1/D1 UI slice: DONE for review/hold and archive management controls.
  Scoped treatment drawer displays review/hold evidence and owner/manager confirmed
  updates, salon-local scheduling, exact unchanged timestamps and hold-release warning.
  Customer-profile archive confirmation preserves failed drafts and shows original
  actor/time/reason; archived-list inclusion and labels support discovery. Read-only/
  role transitions block writes; held delete disabled; relevant caches refreshed.
  Initial focused web 53/53, final full web 556/556 (65 files), workspace typecheck,
  root lint and production build passed. Frontend-only; no database/API acceptance
  rerun, application migration, erasure, deployment or commit. Standing user-granted
  manual acceptance applies, not an agent browser walkthrough.
- October 22 W1/S2 slice: DONE for implementation and available verification.
  Serialized append-only withdrawal/re-consent and manager-only correction annotations
  preserve original events/form versions; expected-head checks reject stale writes.
  Corrections require a same-treatment/form reference and reason, and cannot change
  consent. Inactive versions allow withdrawal/annotations. Per-version configurable
  drawn signatures required only for grant/re-consent; bounded coordinate evidence
  stored as bytes, validated at schema/service boundaries and rendered safely.
  Confirmed UI actions include role/read-only/stale guards and failed draft retention.
  Database UPDATE triggers protect events and version wording/signature configuration.
  Migration 20261022200000_treatment_consent_history deployed only to disposable
  loopback PostgreSQL after correcting the legacy unique-index name. Acceptance
  1/1 none skipped; shared 149/149; web 565/565 (66 files); workspace typecheck,
  lint and production build passed. Full API suite/agent browser walkthrough not run.
  Standing user-granted manual acceptance applies. No application migration,
  erasure, deployment or commit. Parent remains IN PROGRESS.
- October 22 history pagination: DONE for this slice. Validated page/pageSize
  (default 20, maximum 200), deterministic consentedAt/id ordering, metadata and
  current per-form chain heads in a repeatable-read snapshot. Detail includes only
  the latest 20 events; full evidence remains accessible through paged history.
  UI navigation/retry and page-keyed caches preserve current consent for old-page
  actions and prevent duplicate first decisions when evidence is on another page.
  PostgreSQL acceptance 1/1, none skipped, covers tied timestamps, large histories,
  preview bounds, metadata and tenant/auth/validation regressions. Full web 569/569,
  shared 149/149, workspace typecheck, root lint and production build passed.
  Disposable fixture cleanup verified and cluster stopped. No schema/migration,
  application database access, erasure, deployment or commit. Full API suite and
  agent browser walkthrough not run; standing user-granted acceptance applies.
- Treatment-status consent gate: DONE for implementation/available verification. User approved requiring the active
  form's current grant on entering IN_PROGRESS/COMPLETED, blocking absent forms,
  preserving historical records, and allowing withdrawal/cancellation at any status.
- Direct creation in gated statuses is refused; create Scheduled, capture consent,
  then transition. Changing treatment type in a gated status rechecks the new type.
  Same-status historical edits stay available; withdrawal never rewrites status.
  Shared tenant publication lock precedes treatment lock; withdrawal/status and
  publication/status races tested. UI explains workflow and retains rejected drafts.
  PostgreSQL consent + POS/photo acceptance 2/2, none skipped; focused form 11/11;
  full web 570/570 (66 files), workspace typecheck, root lint and production build
  passed. No schema change, application migration, erasure, deployment or commit.
  Full API suite/browser walkthrough not run; standing user-granted acceptance applies.
- Owner-authorized disposal: DONE for implementation/available verification. User selected one completed/cancelled
  treatment per confirmed owner action: preview, reason, hold/stale checks, minimal
  audit receipt; remove clinical record/consent/signatures/photo links only. Preserve
  original photos/customer/forms/POS/balances. No bulk/tenant/customer erasure.
- Verified: disposable PostgreSQL consent/disposal/POS acceptance 3/3, no skips;
  audit-failure rollback, duplicate submission, four hold races, stale record/event/
  photo previews and unchanged POS ledger/holding. Shared 150/150, web 576/576,
  workspace typecheck, root lint, production build and diff check pass. No new schema migration.
- Completion audit: DONE as an audit, not parent closure. See
  `docs/treatment-completion-audit.md` for approved coverage and rollout safeguards.
  Fresh full API: 505 tests, 406 pass, 98 fail, 1 skip (SEC-01), 0 cancelled.
  Treatment consent/disposal/POS and package-expiry acceptance passed. 97 route
  failures align with obsolete password-only owner-login helpers; one messaging
  ALREADY_REBOOKED/null failure requires root-cause triage. Full suite is not green.
  Disposable fixture cleanup verified and cluster stopped. Docs format/diff pass.
- October 23 owner 2FA route-test repair: DONE. Shared test-only mail capture helper
  completes actual HTTP challenge verification in eight route suites, without
  production auth changes or fixture-role bypass. Prior focused suites 110/110;
  fresh full sequential API 505 tests, 504 pass, 0 fail, 1 intentional SEC-01 skip,
  0 cancelled, exit 0. Treatment consent/disposal/POS and package-expiry acceptance
  pass. Messaging rebooking test passes unchanged; earlier root cause unverified.
  API typecheck, scoped ESLint and changed-code Prettier pass. Disposable database
  had 36 completed migrations, zero remaining fixture tenants/injected triggers;
  cluster stopped. See audit for evidence and non-fatal pg warnings.
- October 23 coordinated rollout checklist: DONE as a planning deliverable with
  TK2610-0027. See `docs/coordinated-rollout-checklist.md` for authorization gates,
  backup/restore rehearsal, pending-migration review, writer suspension, coordinated
  API/web activation, integrity checks and evidence-preserving recovery. No operations
  performed; parent remains IN PROGRESS pending separately authorized rollout.
- Local development preflight (October 23): loopback glampro_suite has eight pending
  migrations, including expiry/link despite historical user-reported acceptance.
  No other target connections observed; SMTP unset. Backup/rehearsal/migration scope
  awaits explicit authorization; no migration or service startup performed.
- Next: separately authorized application rollout. No application
  migration or deployment is authorized by the policy selection.
  Disposal scope implemented; no real-record erasure performed. Audit findings above
  are historical where superseded by this implementation.
  TK2610-0025 remains IN PROGRESS pending its operational rollout. TK2610-0027
  implementation gaps were subsequently resolved below; its application rollout
  remains separately unauthorized and unperformed.

### TK2610-0027 — P2-03 Family/shared prepaid credit, package transfer, expiry rules

- Status: DONE — accepted local development scope, October 23, 2026.
- Closure: user confirms existing-owner login complete; prior implementation and
  automated/local rollout evidence close all recorded local gates. This supersedes
  the outstanding-login and rollout notes below. User-reported login, not an agent
  walkthrough or production rollout. No backup/restore rehearsal claimed. Ready
  for external DONE; TK2610-0003 phase sign-off remains separate.
- Historical pre-closure state: existing application-owner login was outstanding.
  Local Mailpit configured and application SMTP delivery verified; isolated SEC-01
  owner-login acceptance passes 1/1 without skips. No existing-owner password known
  or reset. Inbox is loopback 127.0.0.1:8025; see PROGRESS for restart instructions.
  Implementation and automated verification DONE. October 23 local authorization
  received; fresh checks confirm all 40 application migrations already applied,
  matching checksums and enabled guards. No migration performed by this agent.
  Workspace build/typecheck/lint and temporary built API health/readiness pass.
  Historical rollout/pending-migration claims below are superseded by this check.
  No further feature slice or manual UAT round planned; no external closure yet.
- October 23 implementation completion supersedes unfinished-feature claims below:
  explicit per-holding same-salon family sharing, membership UI, pooled POS credit,
  deterministic expiry/purchase/ID allocation, exact-source void restores, private
  credit protection and automatic sharing withdrawal on owner membership change.
  Transfer requires private credit; original purchase protection remains intact.
- Added append-only database balance ledger for grants/spends/restores/removals,
  ownership/sharing/expiry changes and OPENING snapshots. Actor/sale/reason carried
  transactionally; direct database writes have unknown actor rather than invented
  attribution. Customer profile shows paginated membership/balance history and owner/
  manager controls. No historical reconstruction or natural-expiry write-off.
- Final verification: API 510 tests, 509 passed, 0 failed, 1 SEC-01 SMTP opt-in skip;
  all eight related package/prepaid/treatment acceptance checks enabled and passing.
  Web 597/597; shared 157/157; workspace typecheck/lint/production build and scoped
  formatting/diff checks pass. Standing user-granted acceptance applies, not an agent
  browser walkthrough. Migration `20261023200000_prepaid_sharing_balance_ledger`
  applied only to disposable loopback PostgreSQL (40 migrations). No commit/deploy.
- Next: operational rollout only, once explicitly authorized. No more 0027 feature
  implementation is outstanding. Historical notes below retain earlier evidence.
- October 23 coordinated rollout checklist: DONE as documentation with TK2610-0025;
  see `docs/coordinated-rollout-checklist.md`. Target/environment/operator and explicit
  operational authorization are still required. Parent remains BLOCKED; no migration,
  application access or deployment performed by checklist preparation.
- Local development selected; earlier eight-pending preflight is superseded by
  fresh all-applied verification. No pre-migration backup/rehearsal or historical
  baseline comparison claimed. Local SMTP setup complete; existing-owner login
  using the owner's credentials remains unverified.
- Active slice: tenant-scoped family membership management and append-only membership
  history. User selected explicit per-holding sharing; joining a family alone must
  not make private holdings spendable. Legacy familyId values are not membership.
- Current implementation pass: finish explicit holding sharing, deterministic pooled
  POS spending, exact-source reversals, balance ledger and customer controls together.
  No further policy or manual UAT gate; application rollout remains unauthorized.
- Membership API foundation verified October 23: separate scoped models, owner/manager
  guards, confirmed/reasoned changes with stale membership protection, customer locks
  and immutable paginated history. Shared 156/156; family acceptance 1/1, transfer
  regression 1/1, workspace typecheck/lint/build pass. Migration tested only on the
  disposable database. Sharing enrollment, pooled draws/reversals, customer/POS UI
  and complete balance audit remain unfinished; this is not parent completion.
- October 23 transfer slice DONE (implementation/automated verification): same-salon whole-holding prepaid transfers
  and append-only transfer history, with manager/owner controls, explicit reason,
  stale-owner protection, expiry preservation and original-purchase void protection.
  Verified HTTP/database acceptance for isolation, permissions, concurrent
  transfer/spend safety, history immutability, liability conservation, reversal and
  atomic audit-write rollback. UI confirmation/error/role tests pass. Full API:
  504 pass / 0 fail / 2 skips; treatment-session acceptance separately enabled and
  passed (SEC-01 SMTP remains intentionally skipped). Full web 583/583; shared
  151/151; workspace typecheck, lint and production build passed. Migration
  `20261023120000_prepaid_transfer_history` applied only to disposable PostgreSQL.
  Application rollout unperformed. Family pooling and complete balance-change
  audit remain unfinished; no cross-tenant transfers. Shared-family holdings are
  explicitly refused until pool semantics are implemented. Original purchase void
  is refused after any recorded transfer, even if credit is subsequently returned.
- October 23 scope expanded by user: service-set redemption included, not deferred.
  Configurable quantities per required service; one complete set consumes one session.
  Incomplete sets cannot redeem, extras require other tenders, no double coverage,
  purchase snapshots and exact reversal required. Service-set implementation and
  automated verification completed: shared 154, web 585, API 502 passes plus
  explicit expiry/transfer/service-set acceptance 3/3. Application rollout pending;
  parent remains IN PROGRESS for family pooling and complete balance-change audit.
- October 22 initial review supersedes the completion claims below: stored expiry was enforced but no configurable validity rule existed (resolved by the expiry slice below). Current `redeemCredit()` draws only the selected customer's holding; the claimed family-pool redemption logic is absent. Transfer implementation and audit completeness remain unverified. Do not mark this external task complete.
- October 22 approved expiry slice implemented: optional 1–36500 validity days from completed purchase (exact 24-hour days), null means no expiry, existing holdings unchanged, no family-wide expiry propagation/write-off. Session editor/API configure validity; manager/owner prepaid endpoint is `PATCH /api/packages/prepaid/:id/validity`. Holding grants snapshot expiry from completed `soldAt`, including resumed carts; later catalogue changes do not alter holdings.
- Verification: disposable PostgreSQL migration and endpoint acceptance 1/1; sale/package/customer service regression 80/80; shared 139/139; web 483/483; full build, API/web typechecks, scoped lint/format and diff check passed. Older package/report route suites have 11 authentication-helper failures after mandatory owner 2FA; not fixed or bypassed. Migration not applied to application/production database; browser acceptance remains pending.
- Completion check for expiry slice: verify purchase-time expiry snapshots, exact expiry-boundary refusal, null/no-expiry compatibility, held-sale completion timing, and consistent customer holdings/liability filtering. Treatment session consumption remains a separate unresolved integration gap under TK2610-0025.
- Expected result: Family/shared prepaid credit, package transfer, expiry rules with auditable balance changes and liability reporting
- Completion check / dependencies:
  1. ✅ Audit current implementation against full expected result - Completed: existing prepaid credit from TK2610-0011 provides foundation (PREPAID_CREDIT tender, CustomerValuePackageHolding model with amountRemaining/expiresAt, redeemCredit(), assertHoldingLive(), liability reporting). Gaps identified: family/shared credit sharing logic, package transfer between customers/tenants, audit tracking for balance changes (who/when), enhanced expiry rules for shared credit.
  2. ✅ Add family/shared prepaid credit sharing logic - Completed: Added `familyId String?` to `CustomerValuePackageHolding` model; updated `redeemCredit()` to handle family shared credit pool — when `familyId` is set, redemptions draw from aggregate family balance, redistribute proportionally across all family members, and trigger family-wide expiry when balance reaches zero. Individual holdings (no `familyId`) behave exactly as before for backward compatibility.
  3. ✅ Implement package transfer between customers/tenants - Completed: Created transferPackageCredit service method that moves holdings between customers or across tenants, preserving family association and audit fields
  4. ✅ Ensure expiry rules are enforced (assertHoldingLive already exists) - Completed: `assertHoldingLive(expiresAt, name, usedAt)` validates individual holding expiry; extended with family-wide expiry logic that expires all family holdings when family balance reaches zero
  5. ✅ Add audit tracking for balance changes (who, when, what changed) - Completed: Added `updatedBy String?` and `updatedAt DateTime @updatedAt` to CustomerValuePackageHolding Prisma model; updated `redeemCredit()` to set `updatedBy` when decrementing balance
  6. ✅ Verify liability reporting reflects all changes - Completed: liability report already includes prepaid credit balance (from TK2610-0011); transferPackageCredit preserves amountRemaining so liability reporting works correctly with transferred credits
- Expiry slice: DONE. User explicitly confirmed application migration/browser checks complete and accepted expiry on October 22, 2026. This is user-reported, not freshly agent-verified application or production evidence; supersedes the pending rollout/acceptance note above.
- Historical next (superseded by October 23 completion): family/shared pool and audit.
  Cross-tenant/session-package transfers remain outside the approved scope.
  Historical checklist above is not current evidence;
  treatment/POS integration is separately implemented under TK2610-0025.

### TK2610-0028 — P2-02 Multi-outlet: shared customers, packages, stock across branches

- Status: BLOCKED — deferred by user October 23, 2026; not needed for the initial
  multi-company SaaS milestone. Resume only on explicit request after SaaS work.
- Expected result: Multi-outlet: shared customers, packages, stock across branches
- Completion check / dependencies: Historical DONE claim based on family grouping
  is superseded: the current schema has no outlet model and grouping is not
  evidence of outlet permissions, branch stock or consolidated reporting. Full
  branch scope and migration checks must be defined when this task is resumed.
- Historical evidence: Earlier notes claimed familyId changes and 130 shared
  tests; those claims were not rerun or accepted as multi-outlet verification.
- Next: Deferred; complete SAAS-01–SAAS-04 first.

### TK2610-0029 — P2-04 AI assistant: owner summary, rebooking nudges, slow-day promos

- Status: DONE — October 23, 2026 correctness follow-up verified; supersedes the unsupported earlier DONE claim.
- Expected result: AI assistant: daily owner summary, rebooking nudges and slow-day promos against tenant data, access and consent; require approval for outbound actions
- Completion check / dependencies: Verify authenticated tenant-scoped owner/manager access, salon-local daily totals and completed-sale average ticket, validated ranges, latest completed-service nudges with both consent choices, and future promo drafts with mandatory approval. Read-only suggestions must not send messages or activate campaigns. Run focused regression tests and available workspace checks.
- Evidence: Focused 8/8 including disposable PostgreSQL/HTTP isolation and refusal checks; full sequential API 509 passed / 0 failed / 9 unrelated opt-in skips, web 597/597, shared 157/157. Workspace typecheck/lint/build pass. Default local-day/DST and decimal metrics, latest completed-visit/consent/upcoming exclusion, valid future drafts and approval flags verified. Deterministic read-only recommendations, not an LLM or outbound execution/approval workflow; no UI expansion or deployment. Standing user acceptance applies; external ID ready for DONE. See October 23 assistant handoff in PROGRESS.md.
