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

## Documentation consolidation

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

- Status: Not assessed
- Expected result: complete all P1 product tasks.
- Completion check / dependencies: all P1 child checks met, evidence reviewed and explicit phase sign-off recorded. Child completion alone does not sign off a phase.

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

- Status: IN PROGRESS — Phases A (booking lifecycle) and B (multi-service bookings) implemented; recurring series and rooms/equipment not started
- Expected result: Multi-service bookings, recurring bookings, rooms/equipment resources
- Carried-forward finding (ADRs 0013/0014): cover cancelled-target handling and
  status-only reactivation, not only existing cancelled blockers. Check duration
  snapshots, resize-triggered clashes, active-status parity, field-level errors and
  salon-zone clash messages. Do not claim concurrent exclusion from pre-write reads.
- Assessment (October 20, 2026), verified in code:
  | Capability                  | State                                                                  |
  | --------------------------- | ---------------------------------------------------------------------- |
  | Multi-service booking       | Implemented (Phase B): `AppointmentLine` chain, summed duration.       |
  | Recurring booking           | Absent. No series/recurrence model, no series API or UI.               |
  | Rooms / equipment           | Absent. No resource model; only per-line `staffId` occupancy checked.  |
  | Lifecycle defects (Phase A) | Fixed, with regression tests.                                          |
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
- Remaining (not approved, not started): Phase C recurring series; Phase D rooms/equipment with resource conflict checks. Concurrent overlap protection still depends on a future Postgres `EXCLUDE` constraint (ADR 0014); the pre-write read is unchanged.
- Completion check / dependencies: Verify multi-service/recurring/resource conflicts and booking lifecycle. Resolve duration snapshots, department/active-staff eligibility, service-only resizing bypasses and concurrent overlap protection (ADRs 0013/0014).
- Next: user decision on Phases C–D scope. No commit and no deployment performed; the migration exists but has not been applied to the application database.

### TK2610-0022 — P1-03 Online booking page + deposits / no-show fee

- Status: Not assessed
- Expected result: Online booking page + deposits / no-show fee
- Completion check / dependencies: Verify public booking, availability, deposits/no-show rules, payment lifecycle and tenant isolation. Depends on booking correctness and selected payment/provider policy.
- Next: audit current implementation against the full expected result and check.

### TK2610-0023 — MILESTONE – Final launch readiness review (22 Oct)

- Status: Not assessed
- Expected result: review launch scope, integrated validation, security and operational readiness.
- Completion check / dependencies: required child tasks complete and explicit readiness sign-off recorded. Do not infer approval from dates or test counts.

### TK2610-0003 — Phase 3 – P2 Vertical, differentiators & go-to-market

- Status: Not assessed
- Expected result: complete all P2 product tasks.
- Completion check / dependencies: all P2 child checks met, evidence reviewed and explicit phase sign-off recorded. Child completion alone does not sign off a phase.

### TK2610-0024 — P2-06 Rebrand from Glampro Salon; trademark & domain checks

- Status: Not assessed
- Expected result: Rebrand from 'Glampro Salon' to chosen product name; trademark & domain checks
- Completion check / dependencies: Verify Glampro Suite branding, trademark checks (IPOS/MyIPO) and domain checks with external evidence. Existing web/repository rename does not complete clearance.
- Next: audit current implementation against the full expected result and check.

### TK2610-0026 — P2-05 PSG pre-approved listing – prepare & submit application

- Status: Not assessed
- Expected result: Apply for PSG pre-approved solution listing
- Completion check / dependencies: Confirm current eligibility externally, prepare documentation and retain submission evidence. Code alone does not complete the application.
- Next: audit current implementation against the full expected result and check.

### TK2610-0025 — P2-01 Aesthetics/spa module

- Status: Not assessed
- Expected result: Aesthetics/spa: consent forms, before/after photos, treatment records, session tracking, package expiry
- Completion check / dependencies: Verify consent forms, before/after photos, treatment records, session tracking and package expiry with privacy/access controls.
- Next: audit current implementation against the full expected result and check.

### TK2610-0027 — P2-03 Family/shared prepaid credit, package transfer, expiry rules

- Status: Not assessed
- Expected result: Family/shared prepaid credit, package transfer, expiry rules
- Completion check / dependencies: Verify family/shared credit, package transfer and expiry rules with auditable balance changes and liability reporting.
- Next: audit current implementation against the full expected result and check.

### TK2610-0028 — P2-02 Multi-outlet: shared customers, packages, stock across branches

- Status: Not assessed
- Expected result: Multi-outlet: shared customers, packages, stock across branches
- Completion check / dependencies: Define branch permissions and verify shared customers, packages and stock without cross-tenant leakage; depends on outlet architecture and ledgers.
- Next: audit current implementation against the full expected result and check.

### TK2610-0029 — P2-04 AI assistant: owner summary, rebooking nudges, slow-day promos

- Status: Not assessed
- Expected result: AI assistant: daily owner summary, rebooking nudges, slow-day promos
- Completion check / dependencies: Verify owner summaries, rebooking nudges and slow-day promotions against tenant data, access and consent; require approval for outbound actions.
- Next: audit current implementation against the full expected result and check.
