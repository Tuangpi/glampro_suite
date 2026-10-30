# Commission & Payroll tasks

## Workflow

First-priority queue approved October 27, 2026. Use this queue rather than the
superseded SC tracker or unrelated root backlog. Read PROJECT, DECISIONS,
REQUIREMENTS and PROGRESS before resuming. Start the first unblocked TODO task,
mark it IN PROGRESS before implementation, verify it, update handoff, then stop.
Resume IN PROGRESS work before selecting a TODO. For CP-005, use the delivery
milestones below: a helper, test group or prerequisite is not a stopping point.
Complete the selected milestone and its verification before a routine handoff;
do not automatically start the next milestone. Stop earlier only for a genuine
blocker, user instruction or session limit, and record the exact unfinished work.
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

- Status: **DONE** (October 28, 2026).
- Completion: owner explicitly authorized isolated disposable DB acceptance only.
  Fresh PostgreSQL 18 cluster at loopback 55476, verified `/tmp` data directory,
  63 migrations replayed. Targeted collection/session/value lifecycle, HTTP,
  rollback/immutability/audit/isolation and concurrent payment/spend/refund/transfer/
  session-void acceptance **18/18 on three consecutive runs**, no skips. Route/helper
  regression **210/210**, shared **290/290**, full serial web **963/963**; API/web
  typecheck/lint/build pass. Disposable cluster stopped. Application/production DBs
  untouched during authorized acceptance; prior migration incident remains recorded.
  CP-005 is next but not started. CP-003A remains after CP-005. No activation,
  deployment, commit or push; browser release acceptance/FR-POS-09 remain later gates.
- Historical checkpoints below are retained; earlier DB-pause blockers and
  incomplete-verification counts are superseded by the completion evidence above.
- Detail/write consistency and void boundary: extracted one original collection/
  seller/rate validator; preview flags missing sources/debt; reversed lines rejected;
  new negative bases are EARNED even when original lines are PAID. Added eight detail,
  three status, two real void-entry and two UI cases. Expanded non-DB API 148/148,
  focused UI 57/57, shared 290/290; API/web typecheck/lint and API build pass.
  Completion BLOCKED by retained DB pause: mandatory real transactional/POS,
  rollback/race acceptance has not run. Do not mark DONE or advance CP-005.
- Value collection-ingestion seam: 22 new non-DB integration cases run real
  collection allocation/payroll capture/detail/refund against in-memory persistence.
  Cash/card/later-payment lineage, exact GST residuals, retries, credit/unsettled
  source refusal and post-refund collection guard pass. Focused API 116/116; API
  typecheck/lint pass. No runtime changes or DB work. Payment recording endpoints,
  gateway settlement, SQL isolation/rollback/races and detail eligibility remain open.
- Value source-evidence increment: 21 new non-DB cases cover three collection
  sources, split sellers, payout-tender independence, partial debt, source corruption
  and ordering. Fixed arbitrary first-source fallback-rate selection: positive
  payouts reject absent/conflicting historical rates. Focused API 94/94; API
  typecheck/lint/build pass. Payment ingestion/mixed-tender settlement and SQL
  isolation/rollback/race acceptance remain unverified. No DB work.
- Value-package HTTP boundary tests: real routers/auth/tokens/module/role/writable/
  outlet/validation middleware with in-memory persistence doubles, 41/41 new cases;
  combined focused non-DB API 73/73, API typecheck/lint pass. No runtime behavior
  changes or DB work. Scope propagation is tested, not SQL tenant isolation.
  Broader source/mixed-tender and real DB lifecycle/rollback/race acceptance remain.
- Value-refund detail/UI increment: customer-bound evidence read endpoint, strict
  shared read contract, prepaid economics entry point and reasoned/confirmed exact
  refund preview with actual tender and zero/NONE cancellation implemented. Focused
  web 55/55, non-DB API 32/32, shared 290/290; workspace typechecks/lint and web
  build pass. Full web 958/959 (unmodified PayrollPlans timeout); isolated rerun
  23/23. No DB work. HTTP/DB lifecycle/race acceptance still prevents DONE.
- Value-refund service increment: guarded API endpoint, original purchase/usage/
  collection/seller reconciliation, negative original-seller VP_SALE evidence,
  credit/debt cancellation, identical/conflicting retry handling and post-refund
  collection/void-restoration guards implemented. Non-DB transaction-double tests
  26/26; shared 287/287; API typecheck/lint/build pass. UI and real transactional
  lifecycle/race acceptance remain open. No DB work; CP-005/CP-003A untouched.
- Value-package refund foundation: exact paid-to-credit refund quote and original
  purchase schema added, with ten new non-DB tests. Shared 287/287, workspace
  typechecks/lint pass. Not wired to an endpoint or UI; atomic source validation,
  cancellation, retries and lifecycle/race acceptance remain outstanding. Database
  pause prevents CP-004 completion. Do not mark DONE or start CP-005/CP-003A.
- Session-action UI increment: strict exact refund/fee parsing, revision-bound
  correction drafts and void retry keys, synchronous duplicate-write guard.
  Detail UI 27/27, full web 940/940 (107 files), web typecheck/lint/build pass.
  No DB access/tests. Value-package refunds and transactional lifecycle
  acceptance remain open; do not mark DONE/start CP-005. See latest PROGRESS.md.
- Authorized completion increment: implemented zero-payout NONE cancellation,
  refund ordinal/count/collection/source/seller/outstanding validation, captured-award
  clawback, FOC full-list/mixed-credit capture and once-per-sale-line fixed awards.
  New shared arithmetic/contracts and refund-detail UI tests pass; full web 921/921,
  shared 277/277, non-DB PIN HTTP 6/6, typechecks/lint and API/web builds pass.
  Expanded DB lifecycle assertions are written but NOT RUN. All DB work remains
  paused; transactional/race coverage, value-package refunds and complete lifecycle
  acceptance are still outstanding. Do not mark DONE or start CP-005. CP-003A stays
  TODO after CP-005. See latest PROGRESS.md entry for evidence and limitations.
- Refund/economics review continuation: zero-payout rejection confirmed in schema
  and service; FOC uses selected member/nonmember price and receipt-wide credit
  allocation can override it. Fixed-award quantity unit and refund ordinal/count
  validation remain unresolved. Shared 267/267, focused web 25/25, workspace
  typechecks/lint pass. See PROGRESS.md for required cases. No behavior changes;
  all DB work and lifecycle acceptance remain paused. CP-003A stays TODO after CP-005.
- PIN-budget fix: ordinary checkout now bypasses approval throttling, even after
  budget exhaustion. Non-DB HTTP regression tests 6/6, API typecheck/lint pass.
  DB work remains paused. Approval-bearing downstream failures still count;
  distributed limiting and transactional acceptance remain unverified.
- Non-database review checkpoint: user keeps all DB work paused. Shared 267/267,
  focused web 25/25, shared build, workspace typechecks/lint pass. Static review
  found unconditional checkout PIN-budget consumption and zero-payout refund
  cancellation gap; fixed-award quantity and FOC treatment need policy verification.
  See PROGRESS.md. No application behavior changed or lifecycle acceptance claimed.
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

- Status: **IN PROGRESS** (October 28, 2026).
- Dependencies: CP-004.

### Delivery milestones — execution baseline October 30, 2026

These are delivery boundaries within CP-005, not new top-level tasks or proof of
completion. **None of the five milestones is complete.** On “Next” or “Continue”,
resume **CP-005-M1** as one coordinated implementation/verification pass. Do not
stop merely because the next helper or lifecycle subtype passes its tests.

| ID        | Milestone / status                                | Remaining scope and completion gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-005-M1 | Authoritative lifecycle loading — **IN PROGRESS** | Private-credit holding/sale reconciliation, supported monthly integration and private ownership transfers are implemented/tested. Finish historical sharing/membership/consent, restorations, refunds/voids, expiry edits, mixed session-package usage, spend-sale instalments and full-credit paid lines lacking allocation evidence. Gate: required operational paths load through monthly calculate/approve with independent one-to-one evidence, exact money, corruption refusal, stale-draft rejection and immutable approved history. Unsupported required paths remaining fail-closed keep M1 open. |
| CP-005-M2 | Next-open-period source corrections — **TODO**    | Finish operational posting-date handling, idempotency and approval/source races. Gate: real transactional acceptance proves correct next-open-period placement, no duplicate sources and deterministic race/rollback behavior without rewriting approved history.                                                                                                                                                                                                                                                                                                                                          |
| CP-005-M3 | Carry and plan-switch acceptance — **TODO**       | Opening/settlement controls exist; verify end-to-end carry, component mapping, plan switches and approved-month races. Gate: exact balances and component treatment reconcile across periods and plan changes, including concurrent approval.                                                                                                                                                                                                                                                                                                                                                              |
| CP-005-M4 | Application close API/UI integration — **TODO**   | Router/screens remain unmounted. Gate: mounted authenticated tenant/role-safe workflows pass calculate, frozen reads, adjustments, approval and separate payout acceptance. Local integration is not deployment or earnings activation.                                                                                                                                                                                                                                                                                                                                                                    |
| CP-005-M5 | Final acceptance — **TODO**                       | Gate: complete money reconciliation, browser permissions, concurrency/rollback, frozen-history and documented performance checks against the existing acceptance requirements. Passing a selected suite alone is insufficient.                                                                                                                                                                                                                                                                                                                                                                             |

Dependencies: M2 follows M1; M3 follows M2; M4 follows M3; M5 follows M4.
Existing foundations do not make M2–M5 DONE; verify them at their gates. Preserve
CP-003A/CP-006/CP-007 scope and existing release gates; this table does not absorb
or declare those tasks complete. If a required path needs a policy decision,
record the blocker rather than silently removing it from M1.

Use focused tests during implementation, then run the relevant integrated
regression/type/lint/build checks at the milestone boundary. Re-run broad checks
earlier when cross-cutting changes warrant it. Update handoff once per meaningful
delivery or interruption, not once per helper. Report “completed slice; M1 open”
for partial work, never “lifecycle loading done”.

### Implementation evidence and earlier checkpoints

- Private credit ownership transfers (October 30): replay complete balance chain
  against independent transfer audits; verify spend-time owner rather than current
  holding owner. Real monthly original/recipient spends, same-package multi-holding,
  transfer-only stale approval, eight corruption refusals and post-approval return
  transfer pass. Selected close API 298/298, five isolated DB suites, zero skips;
  shared 302/302; API types/lint/build/format pass. Logs `/tmp/cp005-transfer-*`.
  No new sources/fresh cash or original purchase repricing. Sharing and other
  unsupported lifecycle still refuse. Next historical sharing membership/consent,
  then refund/void loading; remaining acceptance unchanged. Not DONE.
- Private-credit monthly integration (October 30): independently matches month
  sales/payments/redemptions/captures/collections to complete private sale/holding
  evidence. Verified tenders add no fresh cash; ratio/ordinary/FOC bases and full
  evidence freeze with inputs. Same-catalogue multi-holding receipts reconcile.
  Real monthly reload, 15 inventory refusal, stale approval, frozen statement and
  empty-next-month checks pass. Selected close API 294/294, five isolated DB suites,
  zero failures/skips; shared 302/302; API types/lint/build pass. Logs
  `/tmp/cp005-month-*`. Narrow supported monthly path enabled internally only;
  next transfer/sharing lifecycle and refund/void loading. Unsupported paths refuse;
  performance/plan-switch/mounting/full app acceptance remain. Not DONE.
- Monthly prepaid lock prerequisite (October 30): outer calculate/approve acquire
  prepaid BEFORE tenant and input reads; direct authoritative loader follows the
  same order. Real PostgreSQL waiting-lock/NOWAIT barriers for both actions verify
  safe writer progress and nested re-entry without close/audit mutation. Selected
  close API 293/293 with all four isolated DB suites, zero failures/skips; API
  types/lint/build pass. Logs `/tmp/cp005-lock-*`. Monthly gate remains closed;
  next integrate month inventory, frozen evidence and no-fresh-cash reconciliation.
- Private value-credit sale allocation continuation (October 30): internal reconciler
  matches complete sale spends to holding histories, exact external payments/GST/
  allocations/sellers, frozen ordinary/FOC economics and splits. Mixed service/product/
  FOC and two-holding checkout, reload, 14 corruption and access/refusal cases pass;
  prepaid tenders add no cash, full-credit paid lines lacking allocation still refuse.
  Selected API 377 passed, one opt-in CP-004 SQL suite skipped; shared 302/302;
  API types/lint/build pass. Logs `/tmp/cp005-value-sale-*`. Monthly gate stays closed:
  next integrate month inventories/frozen/no-cash reconciliation with prepaid-before-
  tenant lock at outer calculate/approve boundary. Transfers/sharing/refunds/voids,
  plan-switch/performance and mounted app/full browser acceptance remain. Not DONE.
- Private value-credit holding history continuation (October 30): internal loader
  takes prepaid then tenant locks; verifies original purchase/external collections,
  complete GRANT/SPEND balance ledger and operational usage/tender/split/ratio/rate
  evidence. Dedicated STORED_CREDIT_SPEND rate replay and real checkout three-spend
  residual/reload/corruption/refusal acceptance pass. Monthly prepaid gate remains
  blocked: sale-level ordinary/prepaid allocation/no-cash integration, transfers/
  sharing and refund/void restoration still need independent evidence. Selected API
  377 passed, one opt-in CP-004 SQL lifecycle suite skipped, four CP-005 isolated DB
  suites ran; shared 302/302; API types/lint/build pass. Logs `/tmp/cp005-value-*`.
  No activation/mounting/application DB/schema changes. CP-005 is **not DONE**.
- Owner carry authorization/repair continuation (October 30): added owner-only
  explicit reviewed opening inventory, component mapping/write-off and exact fallback
  debt write-off controls to the unmounted close screen. Read API returns complete
  staff inventory, independent opening/settlement revisions, exact balance hashes and
  stale flags without allowing missing/stale evidence into calculation or approval.
  Real HTTP/DB acceptance verifies owner/manager refusal, revision conflicts, injected
  actor refusal, server-stamped approval, repair and retry. Selected API 306/306,
  expanded carry acceptance 1/1, selected web 40/40, shared 302/302; API/web types,
  lint and builds pass. Logs `/tmp/cp005-carry-*`. Remaining lifecycle loaders,
  mounting/full browser/reconciliation/performance acceptance still block DONE.
- Restored-session/partial-FOC continuation (October 30): complete original ordinal,
  quantity and ownership replay includes audited void restorations and subsequent
  redraws. Monthly exact latest-source reversal contributes zero cash; request/hash/
  revision/role corruption refuses without changing saved draft/audit. Partial FOC
  separately values uncovered units from immutable checkout list price. Real writer
  retry/reload, restored ordinal reuse, partial FOC and frozen prior-month checks pass.
  Added unmounted close router (strict authenticated actions, carry authorizations,
  own frozen reads) and unmounted management screen (calculation, adjustments, approval,
  separate payout). Selected API **306/306**, including three isolated DB suites and
  seven mocked-persistence real HTTP tests, zero skips; shared **302/302**, selected
  web **40/40**; API/web typecheck, lint and build pass. Logs `/tmp/cp005-complete-*`.
  **Not DONE:** authoritative prepaid-credit spending/refund/void loading, opening/
  settlement UI, app mounting, live HTTP/browser workflows and final reconciliation/
  race/performance acceptance remain. CP-003A/CP-006 untouched. No production activation.
- Monthly correction reconciliation (October 30): complete operational inventory,
  revision-key matching, exact original/replacement lineage and independent zero-money
  reconciliation now support verified corrections internally. Two same-month revisions,
  retry/reload, six corruption refusals and a third following-month correction pass;
  saved draft/audit and approved months remain unchanged. Selected API 277/277 (three
  isolated DB suites, zero skips), shared 302/302; API types/build/lint pass. Session
  void restoration, credit lifecycle, partial FOC and API/UI/full acceptance remain
  next; CP-005 IN PROGRESS, CP-003A/CP-006 untouched. Logs `/tmp/cp005-monthly-*`.
- Redemption correction-chain history (October 30): complete holding snapshot/source
  inventory verifies contiguous replacements and exact prior reversals, original
  ordinals/coverage/value, actor/reason/request hash and historical rates. New writer
  retains original correction request ordering; legacy unbound corrections refuse.
  Real writer verifies two corrections, retry, unchanged session inventory and prior
  approved months; four corruptions refuse. Selected API 276/276 (three isolated DB
  suites, zero skips), shared 302/302; API types/build/lint pass. This is per-holding
  history only: monthly correction operational inventory/no-cash wiring and void
  restoration remain next. Monthly gate retained, CP-005 IN PROGRESS; CP-003A/CP-006
  untouched. Logs `/tmp/cp005-correction-*`.
- Manager-override reconciliation (October 30): verified POS PIN audits now bind to
  usage sale/customer/tenant and historical manager role, actor/reason and paid/used
  counters. Independent complete audit inventory authorizes unpaid draws exactly
  once and freezes with inputs; legacy-unbound or mismatched audits fail closed.
  Real PIN writer/monthly reload preserve original session value and deposit-only
  cash; six audit corruptions preserve draft/audit and approved prior months.
  Selected API 272/272 (three isolated DB suites, zero skips), shared 302/302;
  API typecheck/build/lint pass. Logs `/tmp/cp005-override-*`. Remaining lifecycle,
  partial FOC and API/UI/full acceptance open; CP-005 not DONE, CP-003A/CP-006 untouched.
- Transfer reconciliation (October 29): complete append-only transfer/draw timeline
  verifies original/current owner, owner-at-draw, remaining quantity and expiry.
  Original purchase value/sellers preserved. Real transfer-service write, recipient
  draw/history and monthly reload verified; six corrupted histories refuse without
  draft/audit changes; approved September/October unchanged. Selected API 269/269
  (three isolated DB suites, zero skips), shared 302/302; API types/build/lint pass.
  Manager overrides, reversals/corrections, credit spending/refunds/voids, partial FOC
  and close API/UI/full acceptance remain; CP-005 not DONE. Logs `/tmp/cp005-transfer-*`.
- Package tender reconciliation (October 29): complete sale-level PACKAGE payment
  inventory now matches independently verified coverage using POS residual-cent
  allocation and one tender per draw. Verified package payments add no fresh cash;
  exact monthly payment inventory is cross-checked and frozen. Isolated DB reload
  and missing/altered/gateway/cash-relabeled/credit-relabeled/month-omitted tender
  refusals preserve draft/audit and prior approvals. Remaining unsupported lifecycle,
  partial package FOC, prepaid-credit spending and close API/UI acceptance stay open.
  Selected API 265/265 (three DB suites, zero skips), shared 302/302; API types/build/
  lint pass. Logs `/tmp/cp005-tender-*`; no application DB/schema or activation.
  CP-005 remains IN PROGRESS; CP-003A/CP-006 untouched.
- Monthly redemption integration (October 29): independently reconciled sale coverage/
  holding histories wired into monthly inventory; exact current draws only, ordinary
  services scaled to uncovered quantity, fully covered ordinary captures refused.
  November draft/reload and missing/double-counted captures verified; December
  overclaim refuses without close/audit; approved September/October unchanged. API
  260/260 (three DB tests, zero skips), shared 302/302; types/build/lint pass. Prepaid
  tenders, unsupported lifecycle and partial package FOC stay blocked; not DONE.
- Multi-holding DB acceptance (October 29): independent purchases and real collection/
  draw/capture writers prove shared coverage, uncovered units, missing-capture refusal
  and aggregate overclaim refusal despite valid individual histories, including fresh
  persisted reload. Blocked November writes no close/audit; approved September/October
  hashes unchanged. API 260/260 (three DB tests, zero skips), shared 302/302; API types/
  build/lint pass. Monthly integration remains next; gates retained; not DONE.
- Cross-holding sale coverage (October 29): server-owned complete usage inventory,
  verified holding histories and cumulative coverage bounds added. Two individually
  valid holdings jointly overclaiming a line fail closed. Selected tests 260/260
  (three isolated DB tests, zero skips), shared 302/302; API types/build/lint pass.
  Single-holding real-writer/persisted coverage verified; multi-holding DB acceptance
  and monthly integration still pending. Monthly gates retained; CP-005 not DONE.
- Server-owned holding history (October 29): independent original purchase,
  receipt/payment/debt/tax, capture and redemption inventory loading added for
  original-owner unreversed paid draws. JSONB hash replay fixed; real draw/capture
  and persisted-history acceptance pass. Selected tests 256/256 (three isolated DB
  tests, zero skips), shared 302/302; API types/build/lint pass. Monthly redemption
  gate retained pending cross-holding coverage/wiring and remaining lifecycle work.
  CP-005 stays IN PROGRESS; CP-003A/CP-006 untouched. No application DB/schema/
  backfill/activation/deployment. Disposable cluster stopped after verification.
- Supplied holding reconciliation (October 29): original PER_UNIT/SERVICE_SET
  coverage, exact capture key, receipt-before-draw paid sessions, chronological
  lowest-first ordinals, remaining inventory and aggregate service quantities now
  verified. Selected close/source/session 249 pass/three DB-gated skips, shared
  302/302; API types/lint/build pass. No DB operations or activation. Independent
  operational loading/payment reconciliation, transfer/override/reversal acceptance,
  credit spending/refunds/voids, source corrections and close API/UI remain required.
  Default redemption loader stays blocked; CP-005 is not DONE.
- Redemption evidence foundation (October 29): supplied-record verifier replays
  original ordinals/economics, performer splits, snapshot hash, coverage identity,
  policy/per-session fixed awards and PACKAGE_REDEMPTION historical rates. Default
  loader still blocks redemptions; paid-session/override/transfer/lifecycle and
  cross-redemption coverage reconciliation remain required before wiring it.
  Focused 248 passed/three DB-gated skips, shared 302/302; API types/build/lint pass.
  No DB access/schema/backfill/activation. CP-005 remains IN PROGRESS.
- Cross-month package history checkpoint (October 29): prior sale/outstanding
  payments and captures verified independently without entering monthly cash/bases,
  units or awards again. Original deposit, GST, purchase policy/rates and identities
  enforced. Focused close plus context 245/245 (zero skips, three isolated DB tests),
  selected regressions 49/49, shared 302/302; API types/build/lint passed. Persisted
  September immutable, October boundary balance/recalculation/approval verified
  under explicit post-month test clock. Future receipts remain fail-closed; no
  schema/backfill/activation. Full operational/API/UI acceptance still pending.
  CP-005 remains IN PROGRESS; disposable DB stopped. See latest PROGRESS.
- Same-month outstanding package checkpoint (October 29): independently inventoried
  outstanding payments supported after original sale-payment deposit. Explicit
  tenant/customer/sale/debt identity and receipt amount/time reconciliation;
  collected net only, units/fixed award once. Cross-month history remains blocked.
  Focused plus tenancy 271/271 (zero skips, three isolated DB tests), related
  regressions 133/133, shared 302/302; API types/build/lint passed. No schema change/
  backfill/activation; disposable DB stopped. CP-005 remains IN PROGRESS.
- Same-month package instalment checkpoint (October 29): deposit/later settled
  SALE_PAYMENT receipts supported with complete same-month history and matching
  inventory. Original minimum deposit rounds up on first receipt; net cash per
  receipt, units/fixed award once. Cross-month/outstanding-payment package receipts
  remain blocked. Focused plus tenancy 267/267 (zero skips, three isolated DB tests),
  related regressions 129/129, shared 302/302; API types/build/lint passed. No schema
  change/backfill/activation; disposable DB stopped. CP-005 still IN PROGRESS.
- Full package-purchase checkpoint (October 29): default loader reconciles fully
  collected single-receipt package purchases against immutable original grant,
  canonical economics/settings/sellers and historical PACKAGE_SALE rates. All sale
  policies checked, fixed award once per line. Partial/multiple/missing collections
  and usage/refund/void remain blocked. Focused plus tenancy 265/265 (zero skips,
  three isolated DB tests), related regressions including loader 127/127, shared
  302/302; API types/build/lint passed. No schema change/backfill/activation;
  disposable DB stopped. CP-005 remains IN PROGRESS; full acceptance still pending.
- Value-purchase collection checkpoint (October 29): default loader reconciles
  original immutable holding purchase economics/sellers with external net cash,
  per-seller bases, first-collection units and historical stored-credit sale rates.
  Bonus credit is not cash; unsupported spending/package/refund/void paths remain
  blocked. Focused plus tenancy 260/260 (zero skips, three isolated DB tests),
  related regressions including loader 122/122, shared 302/302; API types/build/lint
  passed. No schema change/backfill/activation; disposable DB stopped, data retained.
  CP-005 remains IN PROGRESS; source corrections/API/UI/full acceptance pending.
- FOC operational-economics checkpoint (October 29): original checkout writes
  immutable independent sale-line snapshot; default close reconciles full FOC list
  price/quantity/performer shares/category and historical rates, never receipt cash
  or current catalogue. Missing original evidence/mixed usage/prepaid fail closed.
  Focused plus tenancy 241/241, zero skips (three DB tests), regressions 78/78,
  shared 302/302; API types/build/lint/schema checks passed. DB-dependent sale suite
  unavailable at intentionally unreachable URL; isolated checkout acceptance passes.
  Migration only in authorized disposable DB, then stopped; no backfill/activation.
  Remaining package/usage/prepaid/refund/void/source corrections/API/UI/full
  acceptance pending. CP-005 remains IN PROGRESS; see latest handoff.
- Ordinary rate-provenance checkpoint (October 29): operational writer freezes
  evaluation time/item/category/legacy rate and per-staff selected rate/source/rule.
  Default ordinary loader replays independent immutable rule inventory as of capture;
  absent/mismatched provenance blocks close, without current catalogue/staff fallback.
  Focused plus tenancy 236/236 (zero skips, three isolated DB tests), related
  regressions 78/78, shared 302/302; API types/build/lint passed. Old captures require
  unavailable readiness, not inferred history. No migration/backfill/activation.
  Remaining operational workflows/source-base corrections/close API/UI/full
  acceptance still pending. See latest handoff; CP-005 remains IN PROGRESS.
- Persisted carry authorization checkpoint (October 29): internal owner-only
  opening/settlement write boundary and immutable hashed revision store now feed
  default authoritative calculation/approval. Complete explicit staff inventory,
  first-close/future boundary checks, server approval metadata, stale-balance
  rejection/reauthorization, tenant isolation, write races and loader stale approval
  verified. Focused 223/223 plus tenancy 4/4; shared 302/302; API types/build/lint
  passed. New migration applied only to authorized disposable DB, then stopped.
  Future first-close calculation tested; real first-month approval/full acceptance
  still pending. Remaining operational provenance/loaders, source-base posting and
  close API/UI remain; no activation, CP-003A/CP-006 or production DB work.
- Active continuation (October 29): implement server-owned transactional input
  loading with independent operational inventory, historical configuration, verified
  prior carry and fail-closed unsupported evidence. CP-003A/CP-006 remain untouched.
- Input-loading checkpoint: internal store defaults to the server-owned ordinary
  sale/payment loader; complete independent inventories, base/attribution/tax/cash
  reconciliation, verified prior carry and historical selection added. Unsupported
  packages/usage/refund/void/FOC/prepaid/correction fail closed. Persisted opening/
  settlement and remaining operational provenance are still outstanding; this does
  not complete CP-005. See `CLOSE_ACCEPTANCE.md` and latest handoff for actual tests.
- Isolated persistence/scoped carry checkpoint (October 29): internal tenant-locked
  close store, expected revisions, atomic immutable audit/snapshots, own-data reads,
  payout races and reasoned next-open-month monetary correction verified with a
  synthetic loader in the authorized disposable DB. Scoped plan/fallback statement
  composition and audited supplied carry settlement added; calculation `cp-005-v2`.
  Combined focused 211/211, shared 302/302, existing UI regression 40/40, API
  build/types/lint, shared lint and web types passed. See `CLOSE_ACCEPTANCE.md`.
  No authoritative loader, close API/UI or source-base posting integration yet;
  full acceptance still pending. No production access, activation or deployment.
- Authorization update (October 29): user approved new isolated disposable DB
  implementation/migrations/acceptance only. Existing DBs, production access,
  activation and deployment remain forbidden. Isolated internal persistence and
  synthetic-loader acceptance underway; this is not full authoritative acceptance.
- First-close/approval-integrity checkpoint (October 29): explicit audited supplied
  opening inventory replaces a missing previous close only for an asserted first
  close. Exact nonpositive component/fallback debt and departed staff preserved;
  missing evidence, duplicate scope, positive balances, prior-close conflicts,
  timezone/boundary mismatches and unmapped debt fail closed. Opening revisions
  reject stale approval. Approval replays draft outputs and rejects snapshot
  tampering or approval before calculation. Eleven added tests; focused 207/207,
  shared 298/298, API typecheck/lint/build passed. No DB operations. Authoritative
  first-close/settlement loaders, carry settlement, scoped composition, persistence/
  locks/corrections/API/UI remain. Mandatory transactional/race acceptance is blocked
  by the existing DB pause, not waived by supplied-record tests.
- Ordinary returned-void checkpoint (October 29): full service/product supplied
  cash returns reconcile original sale-line identity, complete supplied inventory,
  historical shares and exact reversals. Current collection overlap checks sale,
  item type, amounts, outlet and shares; same-month returns net to zero. Composer
  retains departed debt and rejects stale disposition approval. Ten added tests;
  focused 196/196 (close/preview-inputs/correction-period/package-void), API
  typecheck/lint/build passed. No DB operations. Cancelled-settlement evidence,
  authoritative loaders and remaining CP-005 acceptance remain pending.
- Returned-cash collection-void checkpoint (October 29): independent settled
  payouts/allocations reconcile full package/value-package returns against original
  collected net/GST, staff splits and exact reversals. Subtract net once; same-month
  collections/returns net to zero. Frozen evidence rejects stale approval. Nine new
  tests; focused 192/192, API typecheck/lint/build and format/whitespace pass.
  Supplied records only; ordinary returned voids, partial/cancelled-settlement cash,
  authoritative loaders and remaining carry/scoped composition/persistence/API/UI
  acceptance remain. No DB operations; CP-005 remains IN PROGRESS.
- No-cash sale-void checkpoint (October 29): explicit independent NO_MOVEMENT
  evidence reconciles complete supplied sale-line/collection reversal identities,
  timing/outlets and exact source negation. Keeps original collected cash intact;
  freezes disposition revisions and preserves departed staff/debt. Conflicting
  refunds, missing or uncertain cash evidence fail closed. Ten new tests; focused
  183/183, API typecheck/lint/build and format/whitespace pass. Supplied records
  only; returned/cancelled-settlement void cash, authoritative loaders, settlement,
  scoped composition, persistence/locking/corrections/API/UI acceptance remain.
  All DB operations paused; CP-005 remains IN PROGRESS.
- Ordinary-sale refund checkpoint (October 29): full service/product refund cash
  reconciles independent tender/settlement totals, GST, original line allocations,
  source-time sellers and exact reversal identities. Net cash subtracts once;
  frozen revisions reject stale approval and departed staff/debt remain included.
  Partial refunds, collection/void cash and conflicting no-cash assertions fail
  closed. Thirteen new tests; focused 173/173, API typecheck/lint/build and
  formatting/whitespace pass. Supplied-record validation only; authoritative
  funding/settlement/loading and remaining carry/composition/persistence/API/UI
  acceptance remain. All database operations paused; CP-005 not DONE.
- Non-cash reversal checkpoint (October 29): independent zero-money operational
  evidence now permits exact redemption/value-spend/session-correction reversals
  without subtracting commission bases from cash. Original identities/lineage,
  date/outlet and frozen revision are checked; missing/foreign/duplicate/mismatched
  evidence fails closed. Composer preserves departed staff/debt and rejects stale
  approval on operational revision changes. Ten new tests; focused 160/160,
  API typecheck/lint/build and formatting/whitespace pass. Supplied records only;
  sale-line/collection cash reversals, authoritative loaders and remaining close
  persistence/settlement/API/UI acceptance remain. All database operations paused.
- Refund cash checkpoint (October 29): package/value-package refunds require
  independent payout and original allocation/seller reconciliation; subtract net
  payouts from exact staff/outlet cash, including negative totals and departed staff.
  Explicit zero/NONE cancellation supported; payout revisions freeze with inputs
  and invalidate stale approval. Generic reversals still fail closed. Twelve new
  tests; focused 150/150, API typecheck/lint/build, formatting/whitespace pass.
  Supplied-record validation only; authoritative settlement/loading, generic reversal
  reconciliation, carry/settlement, scoped composition, persistence/locking,
  correction posting and API/UI/transactional acceptance remain. All DB work paused.
- SUM_INDIVIDUAL checkpoint (October 29): derive selected-rule eligible totals
  across all credited staff with assignment/outlet scope, negative/fixed/excluded
  activity and retained population identities. Composer verifies assertions and
  uses derived group metrics; selected-plan incentive/stale approval tests added.
  Supplied-record evidence only; no DB loading, persistence or acceptance credit.
  Verification: focused 138/138, API typecheck/lint/build, formatting and whitespace
  pass. No database/browser acceptance. CP-005 remains IN PROGRESS.
- Cash-metric checkpoint (October 29): derive exact staff and salon/outlet net
  collections from reconciled allocations/historical attribution, verify caller
  staff/SALON_CASH assertions, include collection-only departed staff and freeze
  attribution revisions. Package attribution matches captured bases/outlet.
  Refund/reversal and SUM_INDIVIDUAL metrics fail closed pending reconciliation.
  Focused non-DB tests 125/125; API typecheck/lint/build pass. Supplied-record
  validation only; trusted loaders, persistence/locks/corrections/API/UI and actual
  transactional acceptance remain. No DB operations; explicit database pause holds.
- October 29 composition checkpoint: non-DB inventory matching, payment/collection/
  GST/package-base reconciliation, next-open-period correction allocation and
  combined input assembly implemented with focused tests. Required departed staff
  derive from activity/debt/manual amounts; no assumed zero carry/metrics.
  These are supplied-record validators, not authoritative DB loaders or complete
  correction posting. Trusted inventory/metrics/refund loading, opening carry,
  settlement, persistence/locking, API/UI and transactional acceptance remain.
  User explicitly retained the all-DB pause; mandatory DB acceptance is blocked.
  Verification: focused non-DB tests 111/111; shared 298/298; API typecheck,
  lint and build exit 0; formatting and whitespace checks pass. Not CP-005 acceptance.
- Legacy exclusion checkpoint: non-DB validation blocks overlapping sales, null
  legacy sale identity and unreconciled rows, including paid/unpaid/zero/unreleased
  and offsetting reversal candidates. Retains sorted, detached legacy evidence.
  Focused tests 75/75; API typecheck/lint/build pass. This checks supplied records,
  not authoritative inventory completeness or disabling the legacy payout path.
  Source inventory, collection/carry loading, corrections, persistence and API/UI
  acceptance remain. No database operations or activation authorized.
- Frozen carry checkpoint: supplied preceding approved close replayed for snapshot
  consistency; stable component carry/exact fallback debt and required staff retained.
  Missing history never becomes zero. Focused tests 67/67; API lint/typecheck/build
  pass. Non-DB evidence validation only; opening carry and authoritative loading remain.
- Source checkpoint: internal candidate source/lineage resolver validates exact
  reversals, dates/outlets/currency/types and duplicate/unavailable evidence.
  Focused source/configuration/close/preview/statement tests 57/57; API
  lint/typecheck/build pass. Not authoritative inventory reconciliation or release.
- Configuration checkpoint: historical profile/staff/settings and month-end plan
  resolver retains selected audit evidence; missing/ambiguous inputs return
  UNAVAILABLE/null. Focused configuration/close/preview/statement tests 42/42 pass.
  API lint/typecheck/build, formatting and whitespace checks pass.
  Resolver only, not the complete authoritative source/collection/carry loader.
- Checkpoint: pure statement assembly and close transitions implemented; shared
  298/298, focused statement/close 18/18, API close/preview 17/17; shared/API
  typecheck/lint pass. Non-activating only: persistence, authoritative loaders,
  source/approval locking, correction allocation, API/UI and real transactional
  acceptance remain. CP-004 DB authorization is not blanket CP-005 permission.
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
