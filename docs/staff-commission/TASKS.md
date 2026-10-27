# Staff commission — tasks

## How to continue

Read PROJECT.md and PROGRESS.md in this folder first. This tracker owns the new
staff-commission work; root task history is not implementation evidence for it.
Use TODO / IN PROGRESS / BLOCKED / DONE, preserve IDs, and complete one selected
task per session. Record actual verification before marking DONE. Do not start
the next task automatically. The user approved the policies on October 26, 2026.

Implementation order: **SC-002 → SC-003 → SC-004 → SC-006 → SC-005 → SC-007**.
SC-006 is a launch dependency, not an optional advanced feature.

## SC-001 — Approved scope and dedicated tracking

- Status: DONE.
- Dependencies: source review and user approval (received October 26, 2026).
- Expected result: dedicated project/tasks/progress files, approved policies separated
  from draft options and test-company examples, and short root pointers.
- Completion check: review files and links; verify task dependencies, approval scope,
  format, and whitespace; preserve unrelated changes. No application code changes.
- Evidence: documentation references, seven unique task IDs, dependency references,
  root pointers, and compact Current State validated; final formatting and diff
  verification recorded in PROGRESS.md.

## SC-002 — Commission foundation and collection design

- Status: DONE — local foundation and disposable PostgreSQL verification, October 26, 2026.
- Dependencies: SC-001.
- Expected result: code-informed design and implemented shared/API commission kinds,
  compatible rate resolution, snapshots, auditable event/reversal ledger, precision,
  idempotency, and period boundaries. Reconcile existing EmployeeCommission consumers
  rather than introduce parallel totals. Specify explicit payment-to-line allocation,
  refund allocation, attribution retention, paid-session eligibility, zero-value and
  legacy behavior, stored-credit ratio handling, and permission mapping for integration.
- Completion check: focused resolver/schema/ledger tests for inheritance/zero, legacy
  service behavior, precedence, effective dates, duplicate protection, exact reversals,
  precision, atomic rollback, tenancy, and period rules. Run applicable lint/typecheck;
  verify schema changes only on disposable databases. Document integration contracts
  and any unresolved blocker before downstream implementation.
- Evidence: FOUNDATION.md records integration/collection/eligibility/legacy/permission
  contracts. Shared 190/190, focused API/resolver/tenancy 13/13 and enabled disposable
  PostgreSQL acceptance 1/1 pass; all 52 migrations replay from empty. Shared build/lint,
  changed API lint and web typecheck pass. Full API lint/typecheck are blocked solely
  by the existing unused platform-auth sendTwoFactorCode import; no new diagnostics.
  New earnings remain disconnected from POS/public routes and excluded from legacy
  reporting until downstream cutover. No application migration or deployment.

## SC-003 — Seller and therapist attribution

- Status: DONE — local implementation and verification, October 27, 2026.
- Dependencies: SC-002.
- Expected result: POS seller/performer attribution, up to four staff with validated
  splits, purchase/redemption commission integration, original-value preservation,
  staff correction and session-void reversals. Preserve cashier versus credited staff
  distinction. Keep financial postings transactional and retry-safe.
- Completion check: API/web tests for required attribution, own-rate splits, same-person
  dual commission, coverage/service sets, transfers/family sharing, staff corrections,
  voids, concurrent retries, failure rollback, and permission/tenant isolation.
  Existing sale/redemption flows and typechecks remain passing. No collection-based
  sale commission release before SC-006 and SC-005.
- Completion evidence: fresh disposable PostgreSQL replay of all 55 migrations;
  focused API/acceptance 72/72 with no skips, shared 196/196, full web 820/820.
  Workspace lint, typecheck and production build pass. Local Chrome verified policy
  publication, invalid/valid seller splits, independent performers, reload persistence,
  cash completion and reasoned void; database readback verifies attribution, separate
  cashier and zero earnings. See VERIFICATION.md for coverage and limitations.
  Eligibility, collection allocation and reporting activation belong to SC-006/SC-005;
  they do not block attribution-only local completion or authorize earnings activation.
- Earlier checkpoint: explicit split capture/persistence/UI implemented and verified (shared
  193/193, focused web 74/74, disposable sale database tests 57/57; 53 migrations replay).
  At that checkpoint, policy/redemption/correction integration remained outstanding.
  Do not treat capture as earned commission.
- Continued checkpoint: required-attribution API policies; immutable redemption coverage,
  original ordinal value and own-rate candidate evidence; explicit whole-set performer
  UI; linked evidence corrections/voids. Disposable acceptance and regression checks
  recorded in PROGRESS.md. Financial posting/current-open-period reversals and remaining
  release acceptance are unfinished.
- Financial checkpoint: internal snapshot-linked exact redemption posting seam (not wired
  into POS); transactional own-rate correction/repost and void reversal into a current
  open period; incompatible legacy/covered-line earnings fail closed. New earnings
  remain disabled in normal flows pending eligibility/reporting cutover. Broader release
  acceptance, policy admin UI and browser walkthrough remain unfinished.
- Policy administration checkpoint: manager/admin Settings card with explicit required
  attribution switches, reasons, revision-pinned drafts, conflict/reload handling and
  read-only support. UI and real HTTP permission/concurrency acceptance pass; see
  PROGRESS.md. Policy UI is implemented, but browser walkthrough, broader release
  acceptance and eligibility/reporting cutover remain unfinished. No earnings activation.
- Correction-route acceptance checkpoint: real HTTP correction/void permissions, expired
  package entitlement, transfer/original-value preservation, current-period rollback,
  concurrent retries, exact reversal/repost and one-time restored sessions verified.
  Shared 196/196, focused web 46/46, focused API 71/71, no skips. Broader mixed-funding
  release acceptance, browser walkthrough and eligibility/reporting cutover remain open.
- Mixed-tender checkpoint: two packages cover distinct units on one service line;
  shared bonus credit and cash fund the remainder. Original values/own-rate splits,
  private-credit rollback, restored owners after sharing withdrawal, void retries and
  no earnings verified. Focused API/PostgreSQL 72/72, no skips; changed-file lint passes.
  This is not collection-allocation or bonus-credit-ratio implementation (SC-006).

## SC-004 — Commission administration

- Status: DONE (local implementation and verification, October 27, 2026).
- Dependencies: SC-002, SC-003.
- Expected result: staff/type matrix, bulk publish, company policy, package override
  and previews using existing UI/rule conventions. Effective dates, reasons, explicit
  zero/inheritance, concurrency control, permissions, and audit are preserved.
- Completion check: API/web tests for bulk atomicity, stale edits, effective dates,
  rule precedence, inactive staff/items, policy validation, snapshot stability,
  tenant isolation, and unauthorized actions; applicable lint/typecheck/build pass.
- Result: all seven kinds, active package/value-package overrides and previews;
  paginated/searchable staff matrix, bounded atomic bulk publication and per-rule
  audit, pinned draft revisions and explicit reload/discard. Existing attribution
  policy remains the company-policy editor. FOC defaults to approved 5% only for
  explicitly classified FOC events. Earnings activation remains disabled.
- Verified: focused API/database 69/69, legacy commission HTTP 1/1, SC-003 database
  regression 5/5, shared 197/197, full web 830/830; workspace lint/typecheck/build.
  Local Chrome exercised real bulk publication and package override/history.
  See ADMINISTRATION.md for reproduction, boundaries and unperformed checks.

## SC-006 — Collection-based commission and eligibility

- Status: IN PROGRESS — later-payment API checkpoint, October 27, 2026.
- Dependencies: SC-002, SC-003, SC-004.
- Expected result: explicit payment-to-line/package allocation, deposits and later
  collections, stored-tax exclusion, source-linked refunds/clawbacks, immutable seller
  allocation evidence, and paid-session eligibility with audited manager override.
  Preserve contracted valuation and separately tracked receivables. Implement agreed
  stored-credit sale/spend bases without duplicate commission. Legacy evidence and
  zero-value cases follow the foundation design, not guessed cash allocation.
- Completion check: isolated acceptance tests reconcile mixed-item/multiple-package
  payments, partial/full collection, tax/discounts, split staff and rate changes,
  refund/void paths, zero-value and unknown historical cases, mixed tender/bonus credit,
  concurrent retries and rollback. Assert no duplicate service/stored-credit earnings
  and no package-valuation regression. Applicable lint/typecheck/tests pass.
- Checkpoint: pure integer allocation/tax/refund/clawback, exact ordinal coverage,
  credit-ratio and funding-partition helpers implemented. Focused 23/23 tests,
  API typecheck/lint pass. Internal append-only collection persistence and rate/seller
  candidate capture now verified: focused API/database 34/34, API build/typecheck/lint,
  fresh replay of all 56 migrations on disposable PostgreSQL. Subsequent opt-in POS
  capture and confirmed sale currency: focused API/POS 91/91, shared 199/199, web
  831/831, workspace build/lint pass; migration 57 applied only on disposable DB.
  Later-payment state/record API now implemented with atomic debt reduction and
  retry protection: focused API/database/HTTP/POS 145/145, shared 201/201,
  workspace typecheck/lint pass. Later-payment UI remains open.
  No earnings activation; refunds/credit/eligibility remain open;
  required continuation and boundaries are recorded in COLLECTIONS.md.

## SC-005 — Commission reports and period close

- Status: TODO.
- Dependencies: SC-002, SC-003, SC-004, SC-006.
- Expected result: per-staff/type commission summary, detail drill-down, customer
  session log, Excel export, auditable adjustments and approval/locking. Actual payment
  status is independent. Corrections to locked periods post to the current open period.
  No salary field or payroll-total claim is needed for this commission-only milestone.
- Completion check: ledger/on-screen/export totals reconcile to the cent at approved
  subtotal rounding; test filters/pagination, timezone/period boundaries, lock races,
  post-lock reversals, own/all-staff permissions and tenant isolation. Synthetic worked
  examples state assumptions. Run relevant tests/typecheck/lint/build and record manual
  UI checks actually performed. First-release gate requires all SC-002–SC-006 tasks DONE.

## SC-007 — Later payroll extension

- Status: TODO (later milestone; not part of first commission release).
- Dependencies: SC-005, SC-006.
- Expected result: effective-dated salary profile, OT, unpaid leave, incentives,
  company levy, staff statements, configurable payroll/collection ratio alert, and
  optional payslip export. Define zero-collection display and payroll permissions.
  Tiers remain deferred. No claim of full statutory payroll/tax compliance.
- Completion check: component and statement calculation tests, effective-date and
  period-close tests, access controls, ratio/zero denominator tests, and export totals;
  applicable lint/typecheck/build. Confirm optional payslip/self-service scope before
  implementation, without reopening already approved core commission policies.
