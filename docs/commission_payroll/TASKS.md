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

- Status: **IN PROGRESS** (October 27, 2026).
- Dependencies: CP-002.
- Checkpoint: configuration storage, immutable published versions/audit, owner-only
  writes, manager salary-redacted reads, company-wide assignment timelines,
  payroll profiles/settings, sample drafts and settings component/band calculator
  UI implemented. Disposable migration and service/HTTP acceptance pass. This is
  partial delivery, not acceptance of the full expected result.
- Follow-up: structured stage/incentive controls, category filters and component
  ordering are implemented in the revision-bound draft. Shared/API/UI charts now
  use the selected calculator stage. JSON import remains an optional advanced tool.
- Follow-up: salary profiles, staff join-date/stage overrides and salon settings now
  use structured shared-schema-validated forms with explicit revision-conflict reload.
- Follow-up: staff/payroll join-date writes now compare captured authoritative dates
  under the same tenant lock. Payroll history requires the reasoned owner workflow;
  disposable races and staff HTTP regression pass. Required-plan creation and full
  staff lifecycle requirement enforcement are still incomplete.
- Follow-up: optional owner-only atomic staff/department/initial-plan creation is
  implemented with join-date validation, captured assignment revision and rollback
  coverage. Mandatory plan/join-date enforcement is still incomplete; this does
  not satisfy FR-ASN-01. See DECISIONS and PROGRESS.
- Remaining: authoritative last-closed-month impact preview; outlet-scoped plan
  assignment semantics; staff create/edit requirement enforcement and remaining
  API/UI/browser acceptance. Metadata editing, opt-in create→payroll continuation,
  staff edit payroll panel, keyed rule-version comparison and paginated audit
  retrieval are now implemented; see PROGRESS for verification and limits. Resume CP-003;
  do not start CP-004 merely because this checkpoint passes focused tests.
- Follow-up: assignment starts cannot precede join dates, and audited join-date
  edits cannot strand assignment history. Transactional rejection/rollback checks
  pass. Mandatory role classification/lifecycle enforcement remains open.
- Follow-up: explicit owner-audited commission classification added to staff payroll
  settings independently of login roles/positions. Commission-earning classification
  requires current-month and ongoing plan coverage; plan removal is guarded. Legacy
  staff remain visibly unclassified; mandatory create/edit lifecycle integration is
  still open, so this does not satisfy FR-ASN-01 or complete CP-003.
- Follow-up: owner creation can now atomically save reasoned classification with
  identity, department links and initial assignment. Classified staff require join
  date; commission earners require current-month plan coverage. Disposable rollback
  and UI submission checks pass. Identity-only compatibility and edit lifecycle
  enforcement remain open; CP-003 stays IN PROGRESS.
- Follow-up: general staff edits/reactivation now validate latest classified payroll
  requirements under the tenant configuration lock before identity/link writes.
  Suspension remains available; repair is through audited payroll settings. Legacy
  unclassified create/edit enforcement and full lifecycle acceptance remain open.
- Follow-up: active edits/reactivation now reject missing or unknown audited
  classification before identity/link writes. Suspension and disabled maintenance
  remain possible; owner reasoned setup is required for recovery. Mandatory
  creation, outlet pooling, historical inputs and browser acceptance remain open.
- Follow-up: staff creation now requires explicit reasoned classification and join
  date, with an initial plan for commission earners. Owner-only POST/UI preserves
  classification permissions; direct service calls cannot create identity-only
  records. Transactional rollback and owner/manager HTTP checks pass. Outlet pooling,
  authoritative historical preview and browser acceptance remain open.
- Follow-up: company-context assignments and initial creation now support scoped
  published plans with server-snapshotted outlet IDs and inactive-outlet rejection.
  Shared pooling partitions eligible/fallback lines and rejects mixed-scope plan
  calculation. Scope history/immutability/stale rollback and UI selection checks
  pass. Full plan/fallback statement and scoped carry/incentive integration belong
  to CP-005; CP-003 historical preview and browser acceptance remain open.
  Verified shared 252/252, web 901/901, disposable focused API/HTTP 25/25,
  serial API 625 passed/34 gated skips/zero failures; build/lint/typechecks pass.
- Follow-up: owner/company historical-preview readiness endpoint resolves the last
  completed salon month, effective assignment/version and pre-close audited staff/
  salon settings in a repeatable-read snapshot. Missing monetary evidence returns
  UNAVAILABLE/null impact, never a fabricated zero or repriced legacy earnings.
  Full impact calculation/equality and UI integration remain open. CP-004 untouched.
- Follow-up: company-owner settings now offers on-demand historical-input readiness,
  with server-owned month/audit evidence, explicit missing inputs and inventory-only
  counts. Runtime revision checks and keyed UI prevent stale results; manager/outlet
  contexts do not expose the panel. Full monetary impact/equality remains open;
  CP-003 stays IN PROGRESS and CP-004 untouched.
  Verified full web 910/910 (106 files), input/timezone 20/20 and web typecheck/lint/build.
- Follow-up: five disposable lifecycle race cases verify atomic competing creation,
  join-date/assignment ordering, classification/removal coverage, repair/reactivation
  and stale settings refusal. Concurrency suite 6/6 passes on three repeated runs;
  API typecheck/lint/build pass. No production code changes required. Final serial
  disposable API regression 636 passed/34 gated skips/zero failures, exit 0.
  Additional interleavings and browser acceptance remain unclaimed; CP-003 stays IN PROGRESS.
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
