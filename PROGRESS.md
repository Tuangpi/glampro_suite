# Glampro Suite — progress

## Current State

- Current task: TK2610-0016 / P1-05 customer profile is **IN PROGRESS**; browser/visual UAT remains. User-authorized local development reset and demo seed completed October 19: `glampro_suite` at `localhost:5432`, all 17 migrations applied including photos, schema diff empty; 6 staff, 10 customers, 13 appointments, 10 sales. Consent notices/events/photos empty; configure a notice and record data consent before uploading photos. Development reset/reseed standing permission is saved in PROJECT. Prior automated checks: API 351/351, web 404/404, shared 96/96; build/typecheck/lint pass. Four unchanged API formatting failures remain. Do not start TK2610-0017 yet.
- Milestone verification (October 19): root production build, typecheck and workspace lint exit 0; web 392/392, shared 92/92 and pure demo-dataset 13/13 tests pass. Root formatting still fails on four unchanged API files. No database-backed API rerun or browser walkthrough; earlier API 339/339 is historical evidence. See the milestone handoff below for the readiness checklist and accepted demo limits.
- Most recent work: TK2610-0012 / P0-06 reports (commit `18c973f`) audited against its completion check and signed off after UAT. The Z-report draws the salon-local day, counts voids by `voidedAt`, splits collected from redeemed and carries the snapshotted GST. The overview returns sales-by-day, top items, service and staff totals with commission, tender subtotals and a liability snapshot that excludes expired/exhausted holdings. ADR 0010 conflict closed: `?threshold=` filters only while row badges use the stored tenant threshold, with a new row-flag test. Verified: API 339/339, web 392/392 across 43 files, API typecheck/ESLint/scoped Prettier and web typecheck pass. That ADR 0010 edit and a Prettier re-wrap of `report.service.ts` are uncommitted.
- Earlier: TK2610-0011 / P0-04 local payment methods and redemption. The four local rails are **recorded tenders** (`PAYNOW_SGQR`, `NETS`, `GRABPAY`, `ATOME`); `PACKAGE` and `PREPAID_CREDIT` are redemption tenders that carry a `holdingId`, draw the holding inside the sale transaction and are restored on void; `GET /api/customers/:id/holdings` feeds the payment sheet. Migration `20261019034125_local_payment_methods_and_redemption_holding` applied locally. ADR 0019 records both decisions (manual recording; credit is fungible). Committed as `c2274bc`.
- Earlier: TK2610-0010 / P0-02 receipts **DONE** — user UAT on October 19, 2026 accepted an email-only scope (WhatsApp deferred to TK2610-0021). `Sale.gstRegistrationNumber` snapshotted at completion; `POST /api/sales/:id/receipt/email` renders the stored receipt; the till has an "Email receipt" dialog.
- Earlier: SETUP-05 database verification and repair. Schema drift found (live DB missing `tenants.time_zone`/`locale` and `tenant_operating_hours` despite `_prisma_migrations` rows; P0-09's 2FA columns existed only in `schema.prisma`). Repaired additively via `npm run db:migrate`: applied pending `20261015210000_tenant_localisation`, `20261016151623_tenant_operating_hours`, and newly generated `20261018141510_user_two_factor_auth` (purely additive, reviewed). No reset/reseed. Backup: `backups/glampro_suite_2026-10-18.dump` (pg_dump); `backups/` gitignored; `.env` never committed.
- Environment facts: PostgreSQL at `localhost:5432`, db `glampro_suite`, shadow `glampro_shadow` also on 5432. Commented-out `SHADOW_DATABASE_URL` in `apps/api/.env` points at stale port 5433 (nothing listens) — use 5432 for shadow commands.
- Verification (SETUP-05, October 18): `prisma migrate status` → 12 migrations, up to date at that time (14 now, after GST and the sale GST-number snapshot); `prisma migrate diff` live-DB↔schema and migrations↔schema both empty (exit 0); 0 rolled-back migrations; API tests 308/308 passed then.
- One stale test fixed: `apps/api/src/routes/auth.routes.test.ts` replay case still asserted pre-P0-09 family revocation; now asserts ADR 0007 behavior (replay → 401 `SESSION_INVALIDATED`, rotated pair stays valid). Test-only change; service behavior unchanged. This was the blocker hiding behind the DB seed failure.
- P0-09 / TK2610-0005 remains DONE; its "integration tests blocked" caveat is now cleared.
- TK2610-0008 / P0-05 — DONE: user completed UAT and marked it done in the external system on October 19, 2026. Its Products.tsx/test changes are committed in 80bd83b (verified via git log; the earlier "uncommitted" note was stale).
- Earlier records report P0-07, P0-08, P0-03 and P1-09 Done. This consolidation does not independently revalidate their product behavior.

## Unresolved decisions and carried-forward findings

These are historical code-review findings, not fresh runtime reproductions. Verify
against current code when starting the related task. No policy is changed here.
Full decision context and evidence qualifications now live in `PROJECT.md`,
Architecture decisions (ADR 0002–0019), and Design integration (Design 1–7).

- ADR 0002: legacy-ID importer and repeat-run fixture verification are not implemented;
  do not infer migration readiness from schema support or seed-generated IDs.
- ADR 0003 / P1-05: customer email normalization is missing; blank input rejects
  rather than normalizes to NULL. Review case-fold collisions before data changes.
- ADR 0004: platform console is an unscheduled architecture direction, not an
  implemented app or an authorization to add a privileged surface.
- ADR 0008: old centered-card review conflicts with the documented October 8 split
  layout. Preserve later composition; inspect Login before claiming fidelity.
- ADR 0014 / P1-02: status-only cancelled reactivation bypasses clash checks;
  cancelled targets may be wrongly refused. Add regression checks for both paths.

| Related task          | Finding / decision needed                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-09; ADR 0007       | Replay behavior resolved: replay rejects without family revocation per ADR 0007, test aligned October 18; password change atomic; forced sign-out exists. Owner recovery/account-removal scope still open.                                                                                                                                                                                                                   |
| P0-06; ADR 0010       | **Resolved October 19, 2026:** `?threshold=` now filters only; each row's `lowStock` badge uses the stored tenant threshold, and `catalogue.service.test.ts` asserts the badge on a row that the override pulled into the list. Reintroducing one threshold for both would reopen this finding.                                                                                                                              |
| P0-02; ADR 0011       | Legacy unnumbered completed receipts have no established backfill guarantee. Held sales also have null numbers; a completed receipt's “number pending” copy must not promise an unsupported future allocation.                                                                                                                                                                                                               |
| P1-07; ADR 0017       | ADR says discounts reduce loyalty points; code/test award catalogue points × quantity. Resolve policy first. Performance totals are not cash collected or commission. Receipt disclosure can omit a positive rate rounded to zero money.                                                                                                                                                                                     |
| P1-07; ADR 0015       | Held-sale review found incomplete listing, stale/current-price mismatch, double-discount preview, lost hold identity after reload, cart replacement and duplicate drafts on uncertain-response retries without idempotency keys.                                                                                                                                                                                             |
| P1-07; ADR 0016       | Void reverses ledger state but does not refund payment. Concurrent replay, missing-product stock restoration, cascading receipt deletion, voided outstanding balances and stale report/customer caches need review; prior tests did not prove every ledger case.                                                                                                                                                             |
| P1-02; ADRs 0013/0014 | Decide duration snapshots versus catalogue refresh on every patch. Service-only and catalogue-driven resizing can bypass clash checks gated on startsAt/staffId. Department eligibility is rechecked, but server lookups do not enforce picker active-status filters; mismatches lack field detail. Till department narrowing is advisory. Review concurrent overlap enforcement; prior tests did not establish race safety. |
| P1-01; ADR 0018       | Day/week/month views exist. Review salon-zone boundaries against newer P0-08 changes; old browser-local findings may be superseded. Week drag/drop, crossing-midnight display and first-page truncation remain scope to assess; read-only presentation is not proof of edit authorization.                                                                                                                                   |
| P0-04 / P1-03 / P1-04 | P0-04's manual-recording decision is now recorded (ADR 0019): no provider onboarding is required for the four local rails, and the remaining provider question is settlement/reconciliation, not acceptance. Deposit/no-show policy, messaging provider and consent still need decisions before P1-03/P1-04.                                                                                                                 |

Detailed rationale and evidence limits are preserved in `PROJECT.md`. Documentation
audits marked Done did not resolve these product decisions or defects.

## External completion notices

Inform only; never edit the PDF or external task system. Based on preserved Done
evidence (not new product verification in this documentation task), these IDs were
already recorded complete and can be marked done externally if not already marked:

- TK2610-0004 / P0-07 — developer-copy cleanup.
- TK2610-0006 / P0-08 — localisation.
- TK2610-0007 / P0-03 — business hours.
- TK2610-0014 / P1-09 — performer-picker cleanup.

TK2610-0008 / P0-05 was signed off Done by the user on October 19, 2026 (UAT
accepted) and is already marked done externally. TK2610-0009 / P0-01,
TK2610-0010 / P0-02, TK2610-0011 / P0-04 and TK2610-0012 / P0-06 passed the user's
UAT check on October 19, 2026; mark them done externally if not already. TK2610-0010
was accepted on an **email-only** scope — WhatsApp e-receipt moves to TK2610-0021.
TK2610-0013 and Phase 1 (TK2610-0001) are ready to mark Done externally: on
October 19, 2026 the user explicitly confirmed P0 is done and ready, following the
milestone review and disclosed limits. No external task system was changed.
This approval does not sign off Phase 2 or final launch readiness.

## Recent handoffs

### October 19, 2026 — Authorized development database reset and demo seed

- User confirmed local `glampro_suite` and standing permission to reset/reseed this
  development database whenever needed. Saved the bounded permission in PROJECT;
  production and other databases are not covered. Existing application work preserved.
- Verified local database/port, created custom-format backup and checked its archive
  listing: `backups/glampro_suite_pre_reset_2026-10-19T06-43-38.597Z.dump`.
  Archive listing was checked, not a restore rehearsal. Backup remains gitignored.
- Initial reset was blocked by Prisma's AI safety gate before data changes. User
  freshly confirmed the exact reset; rerun with that consent succeeded. Ran shared
  build/client generation, `npm run db:reset`, development `npm run db:seed`, and
  migration status. All exited 0; all 17 migrations applied; live schema diff empty.
- Fresh demo: 1 tenant, 6 users, 10 customers, 13 appointments, 10 sales; seed reports
  3 branches, 42 shifts, 12 services, 12 products, 2 packages, 1 value package and
  2 gift cards. Zero privacy notices, consent events and photos. No implicit consent;
  configure tenant notice and grant customer data consent to exercise photo uploads.
- Reset deliberately replaced prior development data and invalidated prior sessions;
  sign in again. No production access, commit or deployment. No full test-suite rerun
  or browser walkthrough in this operational follow-up. Prior implementation test
  results remain historical. TK2610-0016 rollout complete; browser/visual UAT remains.

### October 19, 2026 — TK2610-0016 customer profile implementation (IN PROGRESS)

- Added `/customers/:id`, linked from customer names, with contact/branch details,
  existing editable notes and consent, active holdings, paginated past appointments
  and completed/void purchase history. Future bookings/held carts excluded; statuses
  stay visible. Currency uses major-unit `formatPrice`, not cent-based `formatMoney`.
- Added tenant-scoped CustomerPhoto and additive migration
  `20261019130000_customer_photos`. Bytes live in PostgreSQL, not public `/uploads`.
  Authenticated tenant photo list/read; writable tenant upload/delete; upload requires
  current data consent, checked/locked in the insert transaction. Reads are no-store.
  JPEG/PNG signature checks, 5 MB cap, caption limit, explicit deletion confirmation.
  Original metadata remains; no transcoding, automatic purge or legal-compliance claim.
- Normalized shared request contracts, customer service and demo seed email writes:
  trim/lowercase, blank to NULL, tenant uniqueness and case-insensitive duplicate
  precheck. No existing-email rewrite/merge; existing collision audit still required
  before any future normalization migration. No importer/admin customer writer exists.
- Verified: API **351/351**, zero skipped, on a newly initialized local-only disposable
  PostgreSQL 18 cluster at port 55439; web **404/404** across 46 files; shared **96/96**.
  Root production build, typecheck and workspace lint pass. All 17 migrations deploy
  from empty disposable DB; Prisma datasource-to-schema diff empty. Root format check
  still reports four unchanged API files (auth routes, catalogue route tests, auth
  service, settings service). No clean aggregate verify claim.
- New tests cover tenant/unauthenticated photo/history denial, consent withdrawal,
  suspended photo writes, private byte retrieval, malformed format refusal, deletion,
  history pagination/filtering, money scaling, profile editor/read-only UI, upload
  error handling and email normalization/tenant uniqueness. Existing tests retained.
- Remaining: normal local migration rollout and browser/visual walkthrough (customer
  name → profile; notes edit/reload; history pages; balances; grant data consent;
  upload/view/delete a photo; withdraw consent and verify upload refusal). No salon
  DB migration/reset/seed, outbound messages, commit, deployment or external update.
  TK2610-0016 is not ready to mark Done externally. Resume it before TK2610-0017.

### October 19, 2026 — TK2610-0015 local migration and UAT closeout (DONE)

- User explicitly accepted UAT and requested migration. Working tree clean at
  start; reviewed the only pending migration, `20261019120000_customer_consent`.
- Confirmed target is local PostgreSQL `localhost:5432`, database `glampro_suite`.
  Custom-format pre-migration backup created and `pg_restore --list` verified:
  `backups/glampro_suite_pre_consent_2026-10-19T06-01-54-775Z.dump` (gitignored).
  Initial version-specific pg_dump attempt failed; migration was stopped until
  system pg_dump successfully produced the verified archive. No restore test run.
- `npm run db:migrate` applied only the reviewed additive consent migration,
  exit 0. `npm run db:migrate:status`: all 16 applied, exit 0. Live datasource-to-
  schema Prisma diff: no difference, exit 0. No reset, seed or data rewrite.
- Read-only before/after checks: existing row counts unchanged across 36 tables;
  10 customers, all consent false/revision zero; zero notices and consent events.
  No invented notice wording or implicit opt-in. No messages sent.
- No application edits or service restart; full suites were not rerun against the
  existing database. Prior disposable-DB API 347/347, web 399/399, shared 95/95
  remain implementation evidence; this closeout verifies migration, not browser UI.
- TK2610-0015 ready to mark Done externally; user manages external tracker.
  Next ready task: TK2610-0016 / P1-05 Customer profile page; not started here.

### October 19, 2026 — TK2610-0015 implementation (IN PROGRESS; local rollout/UAT remaining)

- User accepted tenant-configured wording/version with grants disabled until
  configured. Managers publish immutable versions in Settings; no supplied default
  legal text or automatic opt-in. Ordinary customer creation/edit does not change
  consent; save a new customer, reopen Edit, and use the separate consent controls.
- Added shared consent contracts/tests, PrivacyNotice and CustomerConsentEvent
  models, default-false customer fields and additive migration
  `20261019120000_customer_consent`. Both new models are tenant-scoped.
- Customer editor shows current wording, separate data/optional marketing choices,
  presentation acknowledgement, paginated history and reload/error states. Grants
  require the current notice; withdrawals remain possible without it. Data-consent
  withdrawal also clears marketing. No signature/self-service proof is implied:
  this is staff-recorded consent with server time and staff id.
- Consent changes and audit events commit atomically; expected revisions prevent
  lost withdrawals/concurrent overwrite. Published wording cannot be edited or
  reused; old wording remains linked in audit history. Staff ids survive deletion.
  Evidence follows customer/tenant deletion; no automatic retention purge exists.
- Added `requireMarketingConsent` for future dispatch consumers and tested refusal
  before opt-in/after withdrawal. No promotional sender currently exists, so no
  real marketing-delivery enforcement is claimed. Receipts and staff 2FA unchanged.
- Verification: disposable PostgreSQL 18 cluster under
  `/tmp/glampro-consent-pg.yHoeDa`, loopback port 55439, new `consent_test` and
  `consent_shadow` databases only. All migrations deploy; DB-to-schema diff empty.
  API 347/347 with 0 skipped, web 399/399 across 45 files, shared 95/95 pass.
  Root build, typecheck and lint exit 0. Tests cover HTTP roles/auth/read-only,
  tenant isolation, strict validation, notice versioning, stale grants, withdrawals,
  actor/time/history, concurrency, default choices and UI permission/error states.
- Root format check still fails on the same four unrelated API files recorded in
  the milestone review; no clean aggregate verify claim. Scoped formatting and
  `git diff --check` pass. Initial test failures (strict notice serialization and
  missing test-fixture module category) fixed and full suites rerun successfully.
- Existing salon database untouched: no reset, seed or migration applied there.
  No outgoing mail, deployment, commit, external status change or browser visual
  check. Existing low-stock/report changes preserved.
- Remaining: apply the reviewed migration through the normal local workflow,
  restart API, then UAT: before configuration grants disabled; publish approved
  separate texts/version as manager; create/edit customer; grant data only then
  marketing; reload; withdraw data and verify both false plus audit history; verify
  staff cannot publish notices. Keep task IN PROGRESS until rollout/UAT is accepted.
- Disposable cluster stopped after verification; its temporary files remain for
  inspection. No existing PostgreSQL instance was stopped or modified.
- Next after completion: TK2610-0016 / P1-05 customer profile page. Do not start it yet.

### October 19, 2026 — TK2610-0015 / P1-06 consent audit (BLOCKED)

- Inspected Customer Prisma model, shared create/update/response contracts,
  customer service/routes and tests, editor and screen tests, tenant context,
  email transport and callers, and the source DOCX requirement.
- No customer consent fields/history exist. Customer writes currently allow
  authenticated tenant members when writable; consent permissions need an explicit
  choice rather than a silent role-policy change. No marketing sender exists;
  current senders are transactional receipt email and staff 2FA.
- DOCX supplies the feature name, not approved privacy-notice text, evidence
  retention or withdrawal policy. Asked the user to choose a technical baseline
  versus providing approved policy before implementation.
- Proposed, not approved: separate data and marketing choices; no automatic opt-in;
  server timestamp, actor and notice version for grants/withdrawals; current-consent
  checks for future marketing consumers; transactional receipts kept separate.
  No automatic deletion or claim of legal compliance is inferred.
- No application edits, database commands, messages sent, or external task changes.
  Application tests were not rerun for this policy-only audit. Existing low-stock
  and report changes remain untouched. Resume this task after the policy decision;
  do not advance to another tracked task.

### October 19, 2026 — TK2610-0013 / P0 readiness review (DONE)

- Reviewed TASKS: TK2610-0004–0012 cover all nine P0 requirements and are recorded
  Done. The user previously accepted live Packages/Gift cards and the GST,
  receipt, payment and reports slices. Those earlier acceptances alone did not
  approve this milestone; October 20 is the original target, not automatic approval.
  The user subsequently explicitly confirmed "yes it's done and ready. please
  continue" on October 19, closing this milestone and the P0 phase gate with the
  disclosed limits retained. Specific walkthrough scenarios were not reported.
- Fresh checks: root `npm run build`, `npm run typecheck` and `npm run lint` exit 0; web 43 files /
  392 tests, shared 92 tests, and pure `prisma/seed-data.test.ts` 13 tests pass.
  The dataset checks cover references, clash windows, totals, tender arithmetic
  and stock, not live demo freshness or a repeat-run database seed.
- Root `format:check` reports the same four unchanged files:
  `apps/api/src/routes/auth.routes.ts`, `apps/api/src/routes/catalogue.routes.test.ts`,
  `apps/api/src/services/auth.service.ts`, `apps/api/src/services/settings.service.ts`.
  No clean aggregate `verify` claim. No unrelated formatting or application edits.
- Handoff checks: Prettier on TASKS/PROGRESS and `git diff --check` pass.
- No database reset, seed, migration, existing-data change, external task update,
  commit or deployment. Database-backed API tests were not rerun because this
  session has not established a disposable test database. The prior 339/339
  result is retained as historical evidence, not a fresh regression result.
- Seed inspection confirms demo grants for packages, giftCards and reports, but
  seed code does not establish today's live data. No live browser or email
  delivery verification was performed in this review.

#### Sales-demo walkthrough / explicit approval checklist

Use the intended demo tenant and synthetic customer data. Do not reset/reseed an
existing database merely to make the dashboard look fresh.

1. Log in with the intended demo role; confirm the correct salon, friendly copy,
   S$ amounts, DD/MM/YYYY dates, saved salon timezone and business hours.
2. Show populated Products/Services/Packages/Gift cards and available Reports.
   With an unentitled test tenant, confirm add-on Add controls are hidden and API
   refusal is friendly. Do not change a live tenant's entitlements for the demo.
3. Ring a service/product sale with a customer and performer; show the accepted
   GST setting and tax line. Record a local tender and a package/credit redemption
   using a suitable existing holding; verify the remaining balance and receipt.
4. Show receipt numbering and the email-receipt flow. Verify delivery only with
   an approved recipient and configured transport; UI success is not proof of
   inbox delivery. WhatsApp receipts are deferred to TK2610-0021.
5. Reconcile that sale with the salon-day Z-report and staff/service totals; show
   collected versus redeemed amounts and the liability snapshot. If demonstrating
   void, explain that ledger reversal is not a provider refund.
6. Review desktop/mobile presentation and any observed defects. Confirm the demo
   dataset is useful on the presentation date; relative seed dates do not refresh
   themselves. Record any waiver rather than treating untested steps as passed.

Demo limits: local rails are recorded tenders, not PSP processing/settlement;
package liability is sessions, not a monetary valuation; commission is reporting,
not the P1-08 rules engine; reports have no export/scheduled delivery yet. Known
P1 booking, held-sale and reversal findings remain in the unresolved section and
are not cleared by this milestone review.

- Result: user readiness approval recorded; TK2610-0013 and TK2610-0001 are DONE.
  Verification limitations and known P1 findings remain unchanged; sign-off does
  not turn unperformed checks into passing results or approve final launch.
- Next: TK2610-0015 / P1-06 PDPA consent and marketing opt-in (P1-09 is already
  Done). Not started in this milestone closeout, per the one-task handoff rule.

### October 19, 2026 — TK2610-0012 / P0-06 reports (DONE)

- Found `18c973f feat(reports): add Z-report, liability, and commission reporting` already
  committed, while the tracker still said "Not assessed". Audited it against the completion
  check instead of rebuilding it.
- Z-report: `salonDayBounds` gives the salon-local `[from, to)` day; voids come from
  `voidedAt` inside that day, so a sale rung up yesterday and voided today appears today;
  `collected` and `redeemed` are split by `isRedemptionPaymentMethod`; tax is the
  snapshotted `Sale.taxAmount`. Test fixtures assert the void (999.00) and outstanding
  (10.00) figures.
- Overview: staff rows fold `EmployeePerformance` plus `EmployeeCommission` (sale-linked
  or created in range for period commissions); services, items, days and tenders are
  folded from completed sales only; liability excludes expired and exhausted holdings
  and reports package sessions as a count.
- ADR 0010 closed in `apps/api/src/services/catalogue.service.ts`: `listProducts` keeps
  `filterThreshold` for `?lowStock=true` and uses `badgeThreshold` (the stored tenant
  threshold unless there is no override) for `toProduct`. `catalogue.service.test.ts`
  now asserts both rows of the override-widened page — `Aloha Shampoo` stays
  `lowStock: false` at 10 units where the salon threshold is 5.
- Checks run: API 339/339, web 392/392 across 43 files, API typecheck/ESLint/scoped
  Prettier, web typecheck — all exit 0. Reports screen tests 5/5 and reports endpoint
  tests 6/6.
- Two over-long lines in the committed `report.service.ts` also failed Prettier; they
  were re-wrapped (whitespace only). `format:check` still fails on the four files this
  task never touched, as recorded under TK2610-0011.
- Not committed: the ADR 0010 fix and its test, plus the `report.service.ts` re-wrap. Suggested commits: `fix: keep low-stock badges on the salon threshold when filtering (TK2610-0012)` and `style: format report service`.
- UAT (October 19, 2026): user reported UAT complete on `/reports`; no defects were reported and the exact scenarios exercised were not recorded. The task is now DONE locally; mark it done in the external system if not already.
- Next: TK2610-0013 — MILESTONE: P0 UAT and sales-demo readiness sign-off.

### October 19, 2026 — TK2610-0011 / P0-04 local payment methods + redemption (DONE, implementation)

- Decision (ADR 0019): local rails are **manually recorded** tenders, not a PSP integration.
  PayNow and SGQR share `PAYNOW_SGQR`; `NETS`, `GRABPAY` and `ATOME` have their own codes.
  A redemption is a **tender** (`PACKAGE`, `PREPAID_CREDIT`), never a discount, so totals,
  points and stylist credit stay what the catalogue says.
- Credit is **fungible** (user's answer): prepaid credit pays for any line up to its balance.
  A package covers only the services it lists, in cart order, one session per service unit.
- **Server-side draw.** `redeemPayments()` runs inside the sale transaction: re-reads the
  holding, recomputes coverage (`HOLDING_NOT_COVERED` when the amount disagrees), decreases
  with a `>=` guard (`HOLDING_INSUFFICIENT` on a race), and writes one `CustomerRedemption`
  naming the holding. `HOLDING_NOT_FOUND` (404), `HOLDING_EXPIRED` (409),
  `HOLDING_REQUIRES_CUSTOMER` / `REDEMPTION_EXCEEDS_TOTAL` (400). `reverseForVoid()` restores
  the sessions/credit and stamps `revertedAt` instead of deleting.
- **Schema.** `PaymentMethod` gained six values; `CustomerRedemption.holdingId` + index added
  by additive migration `20261019034125_local_payment_methods_and_redemption_holding`
  (applied locally, no reset).
- **API.** `GET /api/customers/:id/holdings` merges the two ledgers into one list of spendable
  rows (expired/exhausted omitted), each naming the tender that spends it.
- **Web.** Payment sheet offers all eleven tenders; a redemption row picks the holding and
  shows the amount read-only, computed by the same rule as the server. Receipt badges and the
  email receipt name every tender.
- Verification: `prisma migrate status` up to date (DB↔schema diff empty); API typecheck/ESLint/Prettier
  clean; web typecheck and production build pass; API 333/333 (6 new sale-service tests + 5 in the new
  `customers.routes.test.ts`) and web 391/391 across 43 files pass. No browser/E2E automation; the user's
  manual UAT covered the flow.
- User UAT (October 19, 2026): reported complete. The exact scenarios the user exercised were not
  recorded here; no defects were reported back.
- Committed as `c2274bc` with the suggested message.
- Next: TK2610-0012 / P0-06 reports.

### October 19, 2026 — TK2610-0011 / P0-04 UAT sign-off (DONE)

- User confirmed UAT complete on the till. Local payment methods and package/prepaid-credit redemption
  are accepted on the **manually recorded** scope in ADR 0019: no PSP, QR payload, webhook or settlement.
- Local tracker promoted to fully DONE. External task/PDF updates stay with the user.
- Note for the next session: `npm run format:check` fails on four files this task never touched
  (`auth.routes.ts`, `catalogue.routes.test.ts`, `auth.service.ts`, `settings.service.ts`) — pre-existing
  Prettier drift, deliberately left alone.

### October 19, 2026 — TK2610-0010 / P0-02 receipt UAT sign-off (DONE)

- User completed UAT and accepted an **email-only** scope. WhatsApp e-receipt is not
  implemented and moves to TK2610-0021 (P1-04), which still needs a provider, template
  and consent decision. No WhatsApp code was invented.
- **GST snapshot:** `Sale.gstRegistrationNumber` is written by `resolveCart` only while
  the salon's GST is enabled; additive migration
  `20261019120000_sale_gst_registration_number` applied to `glampro_suite`. Reprints keep
  the old number when the setting changes. Historical rows with tax fall back to the
  current salon number; zero-tax rows print none.
- **Email:** `receipt-email.service.ts` builds HTML + text from the stored `SaleDetail`
  (same source as the paper), escaping salon/line copy. `POST /:id/receipt/email` sits
  behind session auth, `requireModule("sales")`, `requireWritableTenant()` and a
  30/15min limiter; 409 for HELD carts, 503 on provider/configuration failure. Dev/test
  use nodemailer's JSON transport; production 503s when SMTP is unset. Sends are
  synchronous — no outbox, retry or delivery confirmation.
- **Web:** `useEmailSaleReceipt` mutation and `EmailReceiptDialog` (prefilled customer
  address, shared-schema validation, stays open with the destination after a send).
- Verification: migration applied; API typecheck + ESLint + Prettier clean; API 322/322 and web
  387/387 pass (new: `sales.routes.test.ts` 5, `receipt-email.service.test.ts` 5). The
  production build was not run this session.
- Changes uncommitted; suggested message
  `feat: snapshot GST number and email sale receipts (TK2610-0010)`.
- Next: TK2610-0011 / P0-04 local payment methods.

### October 19, 2026 — TK2610-0009 / P0-01 GST UAT sign-off (DONE)

- User completed the UAT check (GST settings, sale receipt, report figures) and the
  local tracker is promoted to DONE. External system/PDF updates stay with the user.
- Policy: Singapore GST 9%, inclusive of catalogue prices. Back-calculated per line
  (`lineTotal × 9 / 109`, half-up 2dp); sale tax is the sum of rounded lines. Rate and
  amount are stored on `Sale`/`SaleLine`. GST defaults off, so existing salons are
  unaffected.
- Shipped: shared constants/schemas, additive migration
  `20261019015129_gst_settings_and_sale_tax`, settings service pair guard (`gstEnabled`
  requires a number; a stored number survives a toggle-only PATCH), sale pricing and
  receipt mapping, report tax aggregation, Settings toggle + registration number,
  ReceiptView "Includes GST (9%)" row, Reports GST column and totals tile.
- Verification: migration applied; `build:shared`, shared/API/web typecheck and lint
  exit 0; shared 92/92, web 387/387, API 312/312 pass.
- Changes are uncommitted; suggested message
  `feat: add inclusive GST settings, receipts and reports (TK2610-0009)`.
- Next: TK2610-0010 / P0-02 receipts (thermal print + email/WhatsApp e-receipt with the
  GST number).

### October 19, 2026 — TK2610-0008 / P0-05 UAT sign-off (DONE)

- User confirmed UAT acceptance and marked TK2610-0008 Done in the external system;
  local tracker promoted Ready for UAT to DONE. External system/PDF updates stay
  with the user.
- Correction: the P0-05 `Products.tsx`/test changes previously recorded as
  uncommitted are committed in `80bd83b` (checked with `git log -- Products.tsx`).
- Tracker-only update; no code, tests or database touched this session.
- Next: TK2610-0009 / P0-01 GST settings, tax line on sales & tax reports.

### October 18, 2026 — SETUP-05 database environment (DONE)

- Verified environment: PostgreSQL on `localhost:5432` (only 5432 listening; the
  commented-out `SHADOW_DATABASE_URL` in `apps/api/.env` targets stale port 5433),
  db `glampro_suite`, shadow `glampro_shadow`, `.env` never committed to git.
- Two drift sources repaired, all additive via `npm run db:migrate`, no
  reset/reseed: applied pending `20261015210000_tenant_localisation` and
  `20261016151623_tenant_operating_hours` (live DB was missing `tenants.time_zone`
  / `locale` and `tenant_operating_hours` despite `_prisma_migrations` rows), then
  generated and applied `20261018141510_user_two_factor_auth` for P0-09's 2FA
  columns that existed only in `schema.prisma`.
- Backup before changes: `backups/glampro_suite_2026-10-18.dump` (pg_dump, ~125KB);
  `backups/` added to `.gitignore`.
- One pre-existing test failure surfaced once seed ran: the replay case in
  `apps/api/src/routes/auth.routes.test.ts` still asserted pre-P0-09 family
  revocation. Test updated to ADR 0007 behavior (replay 401 `SESSION_INVALIDATED`;
  rotated pair stays valid). Test-only — `auth.service.ts` unchanged.
- Checks: `prisma migrate status` → 12 migrations, up to date, 0 rolled back;
  `prisma migrate diff` live-DB↔schema and migrations↔schema both "No difference
  detected" (exit 0); API tests 308/308 pass (exit 0). Web/shared not rerun (not
  touched this session). Uncommitted work preserved; no commit/push.

### October 17, 2026 — DOCS-01 three-document migration (DONE)

- Corrected the initial partial consolidation to the clarified scope: only
  PROJECT/TASKS/PROGRESS are maintained project documents. No extra rule file or
  separate decision/design docs. Delivered design assets/README remain unchanged.
- Consolidated ADR 0002–0018 policies, rationale, tradeoffs, code references and
  evidence limits into PROJECT; Design 1–7 retains frame/token/icon/route/checklist
  and primitive-delta details. Workflow is in PROJECT; external notices restored.
- Added missing email, migration, login-layout and cancelled-booking findings.
  Product statuses stay unchanged. Source changes are reference comments only;
  verify token equivalence and preservation of existing uncommitted work.
- Verification: 29 PDF IDs, 24 exact DOCX task requirements and 37 prior statuses
  preserved. All 17 decision IDs and seven design sections have stable destinations;
  retired links removed and active PROJECT links/anchors resolve. Removed 20
  superseded files; docs now contains only DOCX/PDF. Delivered design README stays
  unchanged as an asset, not an additional maintained project document.
- All 66 edited source/schema files have equivalent non-comment contents (TS/TSX
  parse/printed AST comparison, CSS/Prisma comment-stripped comparison). All 287
  other snapshot files are unchanged, including original documents, design assets,
  existing Prisma tenant-scope fix and Products test changes.
- Checks run: web Login/Products/Card/navigation — 4 files, 56/56 tests passed;
  shared catalogue/sales — 53/53 tests passed; scoped Prettier and git diff --check
  passed. No full build/typecheck/API tests or database commands: application edits
  in this task are comments only. No commit/push. Test scripts and safety snapshots
  are outside the repository, not new management documents.

### October 17, 2026 — TK2610-0008 / P0-05 (historical)

- Recorded audit: package/gift-card CRUD, entitlement guards, demo seed grants and
  templates exist. Web Add button now hides for unentitled add-on tabs; read-only
  behavior remains disabled rather than hidden.
- Changed `apps/web/src/pages/Products.tsx` and its test file (still uncommitted).
- Recorded results: web 383/383 tests, web typecheck/lint/build passed. API 308/308
  and shared 87/87 were reused from the earlier baseline, not rerun in this slice.
- Status remains Ready for UAT; live demo entitlement/data verification is not
  established by reading the seed configuration alone.

### October 17, 2026 — SETUP-02 baseline (historical)

- Recorded isolated disposable PostgreSQL 18 migration deploys; no seed/reset or
  existing database use. Temporary cluster stopped after checks.
- Recorded API 308/308, web 381/381, shared 87/87, workspace lint/typecheck passing.
- Added `TenantOperatingHours` to tenant-scoped Prisma models; change remains in
  `apps/api/src/lib/prisma.ts` and is outside this documentation task.
- Full root verify was NOT clean: seven pre-existing formatting failures were
  reported. The old tracker overstated aggregate success. Individual passing
  checks above do not establish a successful `npm run verify`.

### October 17, 2026 — SETUP-06/07/08 decision reviews (historical)

- Recorded evidence reviews for ADRs 0002/0003/0006/0008 in commit `257eead`.
  Decision context is now consolidated in PROJECT. Open findings remain unresolved.

### October 15–16, 2026 — earlier completed product work (historical)

- Tracker records P0-07 copy cleanup, P0-08 localisation, P0-03 business hours and
  P1-09 performer-picker cleanup Done; evidence summaries remain with those tasks.
- Branding was accepted on desktop/mobile October 15; repository rename recorded
  complete for this clone. Neither establishes database rename or trademark checks.
- These results are preserved historical reports, not tests run for DOCS-01.
