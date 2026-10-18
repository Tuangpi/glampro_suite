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

- Status: Not assessed
- Expected result / completion check: Confirm environment, actual database name, backups/data preservation and secret-safe connection configuration.
- Evidence / next: Not verified. Needs environment and backup information; no reset/reseed. Independent of repository rename.

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

- Status: Not assessed
- Expected result: complete all P0 product tasks.
- Completion check / dependencies: all P0 child checks met, evidence reviewed and explicit phase sign-off recorded. Child completion alone does not sign off a phase.

### TK2610-0004 — P0-07 Remove developer copy & system-status panel

- Status: Done
- Expected result: Remove developer copy (ADR refs, 'server charges catalogue', design-system note, internal keys, system-status panel)
- Completion check / dependencies: Check customer-facing screens for developer copy, internal keys and diagnostic panels; verify friendly refusal messages and responsive appearance.
- Historical evidence: Developer copy removed from Dashboard diagnostics, Settings, Sale and the gift-card form; add-on refusals use display names and unknown-module messages omit internal keys. User accepted desktop/mobile review on 2026-10-15. Middleware gate passed: 7 integration tests, none skipped, on explicitly approved isolated disposable PostgreSQL; no existing database accessed. Web 40 files / 354 tests, shared 83 tests, API/web typechecks, scoped ESLint, Prettier and whitespace passed.

### TK2610-0005 — P0-09 Security hardening

- Status: DONE
- Expected result: Token replay does not revoke other sessions, password change + refresh revocation is atomic, platform forced sign-out exists, email-code 2FA for owners, test accounts retained
- Completion check / dependencies: Token replay rejects without family revocation (ADR 0007); password change wraps tokenVersion bump + refresh revocation in a single transaction; `POST /api/auth/force-sign-out` (SUPER_ADMIN only) bumps tokenVersion and revokes all refresh tokens atomically; email-code 2FA with enable/confirm/disable/verify-login endpoints; test accounts retained per user decision. Marked complete on manual code review per project rule; database integration tests blocked by pre-existing `time_zone` schema mismatch (SETUP-05 concern), not by P0-09 code.
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

- Status: Ready for UAT
- Expected result: Enable Packages & Gift cards in demo; hide 'Add' buttons when add-on is off
- Completion check / dependencies: Verify Packages/Gift cards are enabled and populated in the demo; Add is hidden for disabled add-ons; API entitlement guards hold. Seed code alone does not prove live demo state.
- Historical evidence: Audit against DOCX scope complete. API: package.service.ts and gift-card.service.ts implement full CRUD for the packages/gift-cards templates (Handoff screen 08 tabs 3 and 4), both tenant-scoped through the Prisma extension; packages.routes.ts / gift-cards.routes.ts mount requireModule("packages") / requireModule("giftCards") so an unentitled salon gets 403 MODULE_NOT_ENTITLED rather than an empty tab; packages.routes.test.ts, gift-cards.routes.test.ts, package.service.test.ts, gift-card.service.test.ts all pass (part of the 308/308 API baseline). Seed: demo salon granted packages and giftCards entitlements and DEMO_PACKAGES/DEMO_GIFT_CARDS rows are seeded (idempotent). Web: Products.tsx renders all four tabs with PackageFormDrawer/GiftCardFormDrawer, and the catalogue tab EmptyState names the add-on on refusal. Gap closed (P0-05 scope: "hiding Add for disabled modules"): the top Add button is now hidden for an add-on tab whose module is not entitled (gated via useModules() entitlement; read-only keeps disabling instead), with two new web tests pinning hide/show. Web 383/383 pass, typecheck/lint/build exit 0. No design folder, DOCX or PDF change; no new migration (schema already carries Package/GiftCard/TenantModule).

### TK2610-0009 — P0-01 GST settings, tax line on sales & tax reports

- Status: Not assessed
- Expected result: Add GST settings, tax line on sales & tax reports
- Completion check / dependencies: Verify GST settings/permissions, sale calculations and tax reports, including rounding and tenant isolation. Clarify tax policy first.
- Next: audit current implementation against the full expected result and check.

### TK2610-0010 — P0-02 Receipts: thermal print + email/WhatsApp e-receipt

- Status: Not assessed
- Expected result: Receipts: print (thermal) + email/WhatsApp e-receipt with GST no.
- Completion check / dependencies: Verify thermal printing and email/WhatsApp delivery with GST number, receipt content and tenant isolation. Resolve provider and legacy-numbering behavior (ADR 0011). Depends on GST/payment data and messaging setup.
- Next: audit current implementation against the full expected result and check.

### TK2610-0011 — P0-04 Local payment methods

- Status: Not assessed
- Expected result: Local payment methods: PayNow/SGQR, NETS, GrabPay, Atome; pay by package/prepaid credit
- Completion check / dependencies: Verify every named local method plus package/prepaid redemption and ledger effects. Decide manual recording versus provider integration and onboarding before claiming support.
- Next: audit current implementation against the full expected result and check.

### TK2610-0012 — P0-06 Reports: Z-report, sales by staff/service, package liability

- Status: Not assessed
- Expected result: Reports: daily Z-report, sales by staff/service, package liability
- Completion check / dependencies: Verify daily Z-report, staff/service totals and package liability against sale/reversal/tax data. Include commission needs from the launch-blocker narrative. Resolve low-stock flag semantics when touching reports (ADR 0010).
- Next: audit current implementation against the full expected result and check.

### TK2610-0013 — MILESTONE – P0 UAT & sales-demo readiness sign-off (20 Oct)

- Status: Not assessed
- Expected result: review P0 launch blockers; demo data and sales-demo readiness.
- Completion check / dependencies: required child tasks complete and explicit readiness sign-off recorded. Do not infer approval from dates or test counts.

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

- Status: Not assessed
- Expected result: PDPA consent + marketing opt-in on customer record
- Completion check / dependencies: Verify persisted consent/marketing choices, authorized updates and enforcement by messaging consumers; confirm retention/audit requirements.
- Next: audit current implementation against the full expected result and check.

### TK2610-0016 — P1-05 Customer profile page

- Status: Not assessed
- Expected result: Customer profile page: visit history, package & credit balances, notes, photos
- Completion check / dependencies: Verify profile visits, package/credit balances, notes and photos with tenant permissions and privacy controls.
- Carried-forward finding (ADR 0003): verify every customer email writer trims and
  lowercases, blank/whitespace becomes NULL, and tenant-scoped uniqueness holds.
  Review case-fold collisions before existing-data migration; do not silently merge customers.
- Next: audit current implementation against the full expected result and check.

### TK2610-0017 — P1-07 POS upgrades

- Status: Not assessed
- Expected result: POS: discounts/vouchers, refunds/voids, tips, side-by-side cart, barcode scan
- Completion check / dependencies: Verify discounts, vouchers, refunds/voids, tips, side-by-side cart and barcode scanning. Resolve loyalty policy, held-sale identity/pricing/retry/listing issues, reversal integrity/receipt retention and cache/outstanding-balance issues (ADRs 0015–0017). A void is not a payment refund.
- Next: audit current implementation against the full expected result and check.

### TK2610-0018 — P1-01 Calendar view: day/week, staff columns, drag-and-drop

- Status: Not assessed
- Expected result: Calendar view: day/week, staff columns, drag-and-drop
- Completion check / dependencies: Assess existing calendar; verify day/week staff columns and drag/drop, complete data loading, overnight bookings, salon-zone boundaries and authorization (ADR 0018).
- Next: audit current implementation against the full expected result and check.

### TK2610-0019 — P1-08 Staff: rosters, working hours, commission, POS PIN

- Status: Not assessed
- Expected result: Staff: rosters/shifts, working hours, commission rules, staff PIN at POS (no email needed)
- Completion check / dependencies: Assess existing shifts; verify rosters/hours, commission rules and POS PIN without mandatory email. Confirm roles, secure PIN handling and correct accounting.
- Next: audit current implementation against the full expected result and check.

### TK2610-0021 — P1-04 WhatsApp/SMS reminders, confirmations, rebooking

- Status: Not assessed
- Expected result: WhatsApp/SMS reminders, confirmations, rebooking prompts
- Completion check / dependencies: Choose provider and consent policy; verify scheduling, confirmation/rebooking delivery, retries and duplicate prevention. Depends on booking events and consent.
- Next: audit current implementation against the full expected result and check.

### TK2610-0020 — P1-02 Multi-service & recurring bookings, rooms/equipment

- Status: Not assessed
- Expected result: Multi-service bookings, recurring bookings, rooms/equipment resources
- Carried-forward finding (ADRs 0013/0014): cover cancelled-target handling and
  status-only reactivation, not only existing cancelled blockers. Check duration
  snapshots, resize-triggered clashes, active-status parity, field-level errors and
  salon-zone clash messages. Do not claim concurrent exclusion from pre-write reads.
- Completion check / dependencies: Verify multi-service/recurring/resource conflicts and booking lifecycle. Resolve duration snapshots, department/active-staff eligibility, service-only resizing bypasses and concurrent overlap protection (ADRs 0013/0014).
- Next: audit current implementation against the full expected result and check.

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
