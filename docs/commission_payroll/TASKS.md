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

- Status: **DONE** (October 28, 2026; approved configuration-only scope).
- Approved Option 2: historical monetary integration/full-run equality is deferred
  to CP-003A. Missing monetary evidence no longer blocks configuration acceptance,
  but readiness must remain UNAVAILABLE/null and earnings inactive. Scope approval
  alone is not completion; review configuration acceptance evidence before DONE.
- Acceptance: fresh disposable PostgreSQL migration replay (58 migrations), root
  build, workspace typechecks/lint, shared 252/252, full serial API 638 passed/35
  gated skips/zero failures, Chrome 18/18 twice and web 910/910 (106 files) pass.
  Configuration/readiness remain non-activating; missing historical money returns
  UNAVAILABLE/null. See [CONFIGURATION_ACCEPTANCE.md](CONFIGURATION_ACCEPTANCE.md).
  Historical follow-ups below are chronological checkpoints, not current scope/status.
  CP-004 is next ready; not started in this task.
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
- Follow-up: historical evidence gate documented in HISTORICAL_INPUTS.md after
  source/engine inspection; no complete monetary source established. Invalid latest
  pre-close salon settings now retain audit identity and block rather than throw
  or fall back. Salon/staff regression cases pass; focused input/timezone 22/22,
  API typecheck/lint/build pass. Full calculation/equality remain blocked;
  authenticated browser acceptance remains open. CP-003 IN PROGRESS, CP-004 untouched.
- Follow-up: opt-in real Chrome/API readiness acceptance verifies owner/company,
  manager/outlet denial, stale revision/reload, permission loss on retry and failed
  request/recovery. Final suite 7/7 on two runs; default gate skips safely. Focused
  web 29/29, input/timezone 22/22, API typecheck/lint/build pass. This covers readiness,
  not all configuration browser flows or login/2FA/refresh. Complete historical
  calculation/equality remain blocked; CP-003 IN PROGRESS and CP-004 untouched.
- Follow-up: expanded Chrome suite covers reason-required sample creation,
  draft save/publication, published snapshot immutability, duplicate/archive and
  manager write denial with persisted revision/audit checks. Browser 11/11 on two
  runs; focused web 29/29, input/timezone 22/22, API typecheck/lint/build pass.
  Staff classification/assignment and salary/settings browser flows remain open;
  monetary input integration/equality remain blocked. CP-003 stays IN PROGRESS.
- Follow-up: Chrome classification/assignment and salon settings cases verify
  coverage refusal rollback, audited join-date/plan/classification setup, exact
  settings failure/recovery and manager controls/API denial. Browser 15/15 on two
  runs; focused web 29/29, input/timezone 22/22, API typecheck/lint/build pass.
  At that checkpoint, staff creation, salary, scoped assignment and stale-settings browser gaps remained;
  authoritative monetary integration/equality still blocked. CP-003 IN PROGRESS.
- Follow-up: Chrome salary reason/audit/redaction, stale salary/settings reload and
  atomic staff creation with published outlet-scoped assignment now pass. Expanded
  browser suite 18/18 on two runs (17 children plus parent). This closes those named
  browser gaps, not exhaustive lifecycle acceptance. Authoritative historical
  inputs and calculator/full-run impact equality still block CP-003 completion;
  CP-004 remains TODO and earnings remain inactive.
- Expected result: tenant/outlet-safe persistence and authenticated APIs/UI for
  plans, immutable published versions, assignment history, payroll profiles,
  settings, stages, sample-input calculator, chart comparison, read-only historical
  readiness and sample plans. Historical monetary impact belongs to CP-003A.
  Reuse existing users and authorization; no mirrored staff source of truth.
- Completion check: schema/migration checks on disposable DB only; API/UI tests
  for create/duplicate/archive, assignment overlap, last-day version selection,
  invalid tiers/stages, reason/audit requirements, salary permissions, outlet scope,
  concurrent publication and stale revision handling; sample calculator equality
  with the shared engine. Missing historical evidence must produce no monetary
  result; stale/error/permission changes hide prior readiness. Configuration writes
  and readiness reads must not create earnings, mutate paid history or activate payroll.
  Published seed definitions reproduce CP-002 fixtures without altering live tenants.
- Coverage: FR-PLN, FR-SET, FR-STG, FR-ASN, FR-INC configuration;
  FR-PAY-02; C1–C7, C17–C20; TC-14/15/23/24/25 integrated configuration paths.
  Monetary FR-SET-10–FR-SET-12 and historical TC-25 acceptance remain in CP-003A;
  configuration evidence does not accept those historical paths.

## CP-003A — Authoritative historical monetary preview

- Status: **TODO** (deferred by user approval October 28, 2026).
- Dependencies: CP-003, CP-004, CP-005.
- Scheduling: after CP-005, before CP-007 release acceptance.
- Expected result: authorized server-owned historical rate-free inputs, explicit
  complete coverage, frozen opening carry, scoped group metrics and configuration
  revisions, integrated into historical monetary impact preview. Follow
  HISTORICAL_INPUTS.md; existing legacy records do not yet establish this evidence.
- Completion check: preview and full staff-period engine agree on working lines,
  incentives, totals, carry and write-offs using identical complete inputs. Cover
  missing/contradictory evidence versus authoritative zero, disabled/departed staff,
  outlet scope, refunds, fractional units, plan changes and exact-money boundaries.
  Authorization, revision/context changes and failures must not expose stale money.
  Run relevant shared/API/UI tests and authenticated browser acceptance. Keep
  UNAVAILABLE/null until all evidence gates pass; never fabricate prior history.
- Coverage: historical monetary portions of FR-SET-10–FR-SET-12, impact/full-run
  equality and historical TC-25 integration. Remains a must-have release gate.

## CP-004 — Transactional capture and package workflows

- Status: **IN PROGRESS** (October 28, 2026).
- STOP checkpoint: local application migration safety incident recorded in PROGRESS.md.
  Further DB work requires owner review. Lifecycle implementation is partial and
  unaccepted; do not deploy or activate. Latest expanded tests not yet executed.
- Dependencies: CP-003.
- Settings checkpoint (October 28): explicit sale/redemption FOLLOW_PLAN/EXCLUDE/
  FIXED and minimum deposit contracts, nullable prospective catalogue persistence,
  owner-only reasoned/stale-protected writes and atomic audit, editor controls and
  purchase-time settings copy implemented. No inferred defaults or legacy backfill.
  Verification recorded in PROGRESS.md; deposit enforcement and fixed posting remain.
- Settings checks: disposable 60-migration replay, shared 265/265, focused API
  68/68, collection/POS 1/1 (including settings concurrency and rollback), web
  30/30, workspace typechecks/lint and diff pass. No activation.
- Latest checkpoint: new holdings capture immutable original purchase economics,
  sellers and source lineage independent of operational valuation activation.
  Four-decimal ordinal session helper reconciles original net/splits. Legacy null
  evidence cannot be backfilled through updates; transfer/catalogue changes preserve
  snapshots. Economics-only; redemption integration remains.
- Latest verification: disposable 59-migration replay, shared 262/262, focused API
  68/68, collection HTTP/POS integration 1/1 repeated with held-sale/transfer/
  immutability assertions, web 23/23, workspace typechecks/lint pass. No activation.
- Checkpoint (October 28): package collection allocations now atomically snapshot
  rate-free PKG_SALE net bases with original seller splits at four decimals and
  source/time/outlet/GST lineage. Missing confirmed currency/sellers yields
  UNAVAILABLE/null bases. No earnings activation or historical backfill.
- Verification: disposable replay of 58 migrations; shared 257/257; focused API
  68/68; collection integration 1/1, repeated after adding real package checkout/
  balance assertions; focused web 23/23; workspace typechecks/lint pass.
- Remaining: complete source coverage and engine-ready units/modes/fallback;
  service/product/FOC/category capture, package fixed/excluded posting integration,
  deposit/paid-session enforcement and verified PIN override, value-package ratio,
  refund/fixed clawback/void/correction integration and transfer/refund/redemption
  concurrency/POS acceptance. Existing legacy behavior is not CP acceptance.
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
- Dependencies: CP-006, CP-003A.
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
