# Commission & Payroll tasks

## Workflow

First-priority queue approved October 27, 2026. Use this queue rather than the
superseded SC tracker or unrelated root backlog. Read PROJECT, DECISIONS,
REQUIREMENTS and PROGRESS before resuming. Start the first unblocked TODO task,
mark it IN PROGRESS before implementation, verify it, update handoff, then stop.
Existing implementation and reference tests need verification, not automatic credit.

## CP-001 — Establish management and reconcile requirements

- Status: **DONE** (October 27, 2026).
- Dependencies: None.
- Expected result: authoritative new project/decisions/requirements/task/handoff
  files; non-destructive archive of the old tracker; root pointers updated;
  delivered sources and unrelated application changes preserved.
- Completion check: extract and inspect SRS/developer instructions; map all FR
  IDs, NFRs and TC-01–TC-25 to delivery tasks; document discrepancies and adopted
  open-point defaults; verify links, Markdown formatting, archived/source content
  hashes, application-file preservation and diff scope. No feature or DB changes.
- Evidence: all 87 FR IDs, 25 TC cases and seven NFRs mapped; local Markdown
  links resolve; Prettier and git diff whitespace checks pass. SHA-256 verification
  confirms seven archived files, 73 delivered source files and 661 application
  TypeScript/TSX files unchanged. See PROGRESS.md for limitations.

## CP-002 — Calculation engine and acceptance fixtures

- Status: **DONE** (October 27, 2026).
- Dependencies: CP-001.
- Expected result: pure engine in existing shared architecture for flat, whole,
  slice, mixed and fixed-unit calculations; stages, validation, caps, incentives,
  negative bases/carry-forward, fixed/excluded handling and fallback contract.
  Distinguish historical-sheet fixtures from new-policy cash-collected fixtures.
- Completion check: unit tests cover TC-01–TC-08, TC-13–TC-15, TC-17,
  TC-21–TC-25 calculation semantics; explicit four-decimal bases and half-up
  two-decimal results; split-unit/residual, invalid number, missing join date,
  no-plan fixed award, incentive scope and carry mapping cases; relevant shared
  tests, typecheck/lint/build pass. This does not claim POS/API acceptance.
- Coverage: FR-CAL-02–FR-CAL-10 calculation core; FR-PLN-03–FR-PLN-07;
  FR-STG, FR-INC, settings simulator/validation core.
- Evidence: 36 engine tests cover the mapped calculation cases and additional
  precision, split/residual, missing-date, invalid-contract, scoped-metric,
  fallback/fixed and carry-mapping cases. All 237 shared tests pass; shared
  typecheck, lint, build, formatting and whitespace checks pass. Pure examples
  and public shared exports added without dependencies or runtime activation.

## CP-003 — Versioned plans, assignments and settings

- Status: **TODO**.
- Dependencies: CP-002.
- Expected result: tenant/outlet-safe persistence and authenticated APIs/UI for
  plans, immutable published versions, assignment history, payroll profiles,
  settings, stages, calculator, chart comparison, impact preview and sample plans.
  Reuse existing users and authorization; no mirrored staff source of truth.
- Completion check: schema/migration checks on disposable DB only; API/UI tests
  for create/duplicate/archive, assignment overlap, last-day version selection,
  invalid tiers/stages, reason/audit requirements, salary permissions, outlet scope,
  concurrent publication and stale revision handling; calculator/impact equality.
  Published seed definitions reproduce CP-002 fixtures without altering live tenants.
- Coverage: FR-PLN, FR-SET, FR-STG, FR-ASN, FR-INC configuration;
  FR-PAY-02; C1–C7, C17–C20; TC-14/15/23/24/25 integrated configuration paths.

## CP-004 — Transactional capture and package workflows

- Status: **TODO**.
- Dependencies: CP-003.
- Expected result: rate-free bases linked atomically to authoritative source events;
  sellers/performers/splits, category and list-price snapshots, deposits, balance
  collection, paid-session checks and manager PIN override, package fixed/excluded
  settings, value-package ratio snapshots, refunds, session voids and staff
  corrections. Preserve transfer/family ownership and original seller attribution.
- Completion check: real transactional API/POS tests on disposable DB cover
  TC-09–TC-12, TC-16–TC-18; retry/conflicting retry, rollback and concurrent
  payment/redemption/refund/transfer cases; no double commission, external-tender
  allocation, GST separation, FOC snapshot and split-unit totals; fixed-sale refund
  clawback and legacy incomplete-evidence cases. Focused API/shared/web checks pass.
- Coverage: FR-BAS-01–FR-BAS-09, FR-POS, FR-ADJ-01–FR-ADJ-04,
  FR-ADJ-06/07; C8–C13, C16. MTD display uses CP-006 read models; do not
  claim FR-POS-09 accepted until that integration is tested.

## CP-005 — Monthly close and frozen payroll statements

- Status: **TODO**.
- Dependencies: CP-004.
- Expected result: OPEN → CALCULATED → APPROVED workflow, preserved manual
  adjustments, authoritative input revisions, immutable complete statement snapshots,
  safe cross-period corrections/carry-forward and separate payout confirmation.
  Departed staff with activity/amounts owed are included.
- Completion check: integration tests reject stale approval and approval/posting
  races; re-run preserves adjustments; salary/profile/assignment edits cannot change
  approved outputs; own-data/manager/admin permissions and immutable audit verified;
  next-open-period corrections preserve history (TC-19); zero denominator, negative
  carry and plan switches reconcile; relevant API/web/shared tests and checks pass.
- Coverage: FR-CAL orchestration, FR-PAY-01–FR-PAY-04/06, FR-ADJ-05;
  payroll close portions of C14/C15. Export acceptance belongs to CP-006.

## CP-006 — Reports, exports and progress workflows

- Status: **TODO**.
- Dependencies: CP-005.
- Expected result: period summary, statement/base-line drill-down to source,
  customer holding payment/session history, true Excel summary + per-staff sheets,
  payslip PDFs, filtered base-ledger export, MTD/POS progress and own-data staff
  self-service. Reconcile package-value reporting with existing valuation, with
  receivables separate. Gift-card base capture is explicitly could-have, excluded
  from seeds and not a release blocker; record if deferred.
- Completion check: TC-20 workbook and PDF contents equal frozen statements;
  export permissions and spreadsheet/formula escaping tested; report filtering,
  pagination/aggregate completeness, tenant/outlet isolation and source links tested;
  MTD clearly estimated and reconciles to same input/rules; browser/manual gaps
  disclosed; relevant API/UI tests, build/typecheck/lint pass.
- Coverage: FR-PAY-05, FR-RPT-01–FR-RPT-06, FR-POS-09, report/MTD UI;
  FR-BAS-10 explicitly tracked as optional.

## CP-007 — Cutover, reconciliation and release verification

- Status: **TODO**.
- Dependencies: CP-006.
- Expected result: prospective guarded activation, evidence-quality inventory,
  no duplicate legacy/new payouts, safe migration/backfill tooling and rollout/
  rollback documentation. All must-haves accepted; should/could deferrals explicit.
- Completion check: execute TC-01–TC-25 end-to-end acceptance; tenant/role tests,
  rollback/retry/race and statement/export reconciliation; full relevant regression,
  build/typecheck/lint; documented performance for 50 staff/month <10 s and MTD
  <500 ms; cutover dry-run on disposable data and immutable approved-history checks.
  Production migration/activation/deployment requires separate explicit authorization.
- Coverage: NFR-01–NFR-07, SRS seed/migration provisions, all cross-feature
  acceptance and release gating. Historical user acceptance is not CP acceptance.
