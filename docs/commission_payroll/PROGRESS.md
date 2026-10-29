# Commission & Payroll progress

## Current State

- **CP-005 IN PROGRESS — ordinary rate-provenance checkpoint (October 29).**
  Latest completed CP-004; CP-003A/CP-006 untouched. Operational source writer now
  freezes rate evaluation time, item/category, legacy staff rate and selected
  rate/source/rule identity per credited staff. Default ordinary loader independently
  inventories immutable rules and replays selections available when captured.
  Missing provenance, altered rate/category/staff/item/time and rule mismatch block
  close; current staff/catalogue values never reconstruct historical decisions.
- Tested: focused plus tenancy **236/236**, zero skips, including all three isolated
  DB acceptance tests; rate/collection/refund regressions **78/78**; shared **302/302**;
  API typecheck/build/lint passed. Logs/exit markers:
  `/tmp/cp005-rates-{combined,regression,shared,types,build,lint}.{log,exit}`.
  DB loader acceptance preserves captured zero after current legacy-rate edit and
  later-published backdated rule, then recalculates/approves historical salary change.
- Next: remaining CP-005 package/usage/prepaid/FOC/refund/void authoritative loading,
  source-base corrections, close API/UI and full transactional/browser acceptance.
  Historical category/legacy rate are immutable operational capture attestations,
  not independently reconstructed catalogue/user history. Old captures without
  provenance deliberately block; no migration/backfill/activation. Disposable DB
  only, stopped after verification with data retained. No application DB access,
  deployment, commit or push. CP-005 not DONE.

## Previous checkpoint — persisted carry authorization

- **CP-005 IN PROGRESS — persisted carry authorization checkpoint (October 29).**
  Latest completed CP-004; CP-003A/CP-006 untouched. Added internal verified-owner
  opening/settlement persistence and default-loader integration under the tenant
  source lock. Server-stamped actor/time/reason, immutable hashed revisions, complete
  all-staff cutover inventory, no backdated opening, first-close eligibility and
  exact-balance settlements fail closed. Opening changes invalidate settlements;
  explicit owner reauthorization repairs them without changing history.
- Tested: focused **223/223**, plus tenancy schema checks **4/4** in the same run
  (**227/227**, zero skips), including three isolated DB acceptance tests; shared
  **302/302**; API typecheck/build/lint passed. Logs/exit markers:
  `/tmp/cp005-auth-{combined,shared,types,build,lint,migrate}.{log,exit}`.
  DB acceptance calculates a future first close from persisted complete opening and
  write-off without synthetic prior-close bootstrap. Loader unit coverage verifies
  settlement composition, changed-input approval rejection, recalculation and approval.
  Actual first-month end/approval and full payroll acceptance are not claimed.
- Next: continue CP-005 remaining operational loaders/provenance (package, usage,
  prepaid, FOC, refund/void and fallback/classification authenticity), source-base
  corrections, then close API/UI and full transactional/browser acceptance. Opening
  debt is explicit owner attestation, not independently reconstructed legacy debt;
  settlement supports audited remap/write-off, not cash debt repayment. New migration
  applied only to the authorized disposable DB; cluster stopped, data retained.
  No application DB access, activation, deployment, commit or push.

## Previous checkpoint — authoritative ordinary inputs

- **CP-005 IN PROGRESS — authoritative ordinary-input checkpoint (October 29).**
  Latest completed CP-004; CP-003A/CP-006 untouched. Internal calculation/approval
  now default to a server-owned, tenant-locked transactional loader. Independent
  complete sale/payment/usage/refund/void inventories prevent omitted captures from
  becoming empty payroll. Ordinary non-FOC bases, staff/units, recorded cash,
  cumulative GST allocation, historical configuration, prior audited carry and
  cross-close exclusion reconcile. Unsupported packages, prepaid, FOC, usage,
  refund/void/correction workflows fail closed; no fabricated opening zero.
- Tested: focused **221/221**, zero skips, including default-loader isolated DB
  rollback/stale approval/recalculation/immutability and existing persistence races;
  shared **302/302**; API typecheck/build/lint passed. Logs/exit markers:
  `/tmp/cp005-loader-{combined,shared,types,build,lint}.{log,exit}`.
- Next: continue CP-005 complete operational loading/provenance and persisted
  authenticated opening/settlement; then source-base corrections and close API/UI.
  Synthetic preceding close used only to bootstrap DB acceptance; first-close and
  full payroll acceptance are not claimed. No migrations, existing DB access,
  activation, deployment, commit or push. See `CLOSE_ACCEPTANCE.md` for limits.
  Authorized disposable cluster stopped cleanly after checks; data retained.

## Previous current-state checkpoint

- **CP-005 IN PROGRESS — isolated persistence/scoped carry checkpoint (October 29).**
  Latest completed CP-004. User authorized new isolated disposable DB migrations/
  acceptance only; existing DBs, production access, activation and deployment remain
  forbidden. New cluster on loopback 55485, DB `payroll_close_test`; path marker
  `/tmp/cp005-disposable-cluster.path`. Added internal locked close persistence,
  immutable/atomic audit constraints, own-data reads, payout race protection and
  next-open-month monetary correction. Synthetic loader acceptance only; no route.
  Added scoped plan/fallback statement composition (`cp-005-v2`), fixed-award pooling,
  supplied audited opening carry/settlement and draft-output replay protection.
  Combined focused 211/211 incl. isolated DB, shared 302/302, existing UI regressions
  40/40; API build/types/lint, shared lint and web typecheck passed.
  See `CLOSE_ACCEPTANCE.md` for exact scope, logs and limits. Next: authoritative
  complete operational/settlement/carry loader and persisted authenticated opening/
  settlement workflows; source-base corrections, close API/UI and full transactional/
  browser acceptance still required. CP-005 not DONE. Do not start CP-003A/CP-006.
  Disposable cluster stopped cleanly after checks; data retained for continuation.

## Prior checkpoint history

- **Active: CP-005 IN PROGRESS; completion DB-blocked (October 29, 2026).** Latest
  completed task CP-004. User requested continuation through CP-005 completion;
  no permission to lift the explicit DB pause has been inferred. Latest checkpoint:
  explicit audited supplied opening carry and first-close composition; preserves
  component/fallback debt, requires complete first-close evidence, rejects conflicts
  and stale revisions. Draft approval now replays outputs and rejects stored
  snapshot tampering and approval before calculation. Eleven added tests; focused
  207/207, shared 298/298, API typecheck/lint/build passed. Logs/exit markers:
  `/tmp/cp005-continuation-{tests,shared,types,lint,build}.log` / `.exit`.
  No DB access, migrations, activation, deployment or browser acceptance. Mandatory
  transactional/race acceptance cannot pass under the pause. Remaining: trusted
  settlement/opening loaders, cancelled-settlement evidence, carry settlement,
  scoped composition, persistence/locking, correction posting, API/UI acceptance.
  Next decision: retain all-DB pause or explicitly authorize disposable isolated DB
  implementation/acceptance only. Production and activation remain unauthorized.

## Recent checkpoints

- **October 29, 2026 — CP-005 ordinary returned-void checkpoint:** CP-005
  IN PROGRESS; latest completed CP-004. Full service/product returned voids now
  reconcile independent payout tenders/full external-cash allocations against
  original sale-line identity, historical staff splits and exact reversals.
  Complete supplied sale-line inventory required; mixed ordinary/package sources
  and partial/uncertain returns remain unsupported. Overlapping current collections
  must match sale, item type, amounts, outlet and historical shares. Returned net
  subtracts once; same-month service/product returns net to zero. Frozen disposition
  revisions reject stale approval and departed-staff debt remains intact.
  Ten added tests; focused 196/196 (payroll-close, preview-inputs, correction-period,
  package-void), API typecheck/lint/build passed. Logs and exit markers:
  `/tmp/cp005-ordinary-void-{tests,types,lint,build}.log` / `.exit`.
  Tests disabled dotenv and used an unusable loopback DB URL. No DB access,
  migrations, activation, deployment or transactional/browser acceptance occurred.
  Supplied evidence still cannot prove settlement authenticity/timing, historical
  allocation identity, inventory completeness or prior/cross-workflow exclusivity.
  Next: cancelled-settlement evidence and authoritative-loader design, then remaining
  carry/settlement, scoped composition, persistence/locking, correction posting and
  API/UI acceptance. Do not mark CP-005 DONE or start CP-003A/CP-006.

- **October 29, 2026 — CP-005 returned-cash collection-void checkpoint:** CP-005
  IN PROGRESS; latest completed CP-004. Independent RETURNED disposition with
  settled payout tenders and complete package/value-package original allocation
  evidence now reconciles full collected returns. Exact net/GST/gross, original
  source identities/staff splits and exact reversals checked; net cash subtracts
  once. Same-month collections/returns net to zero; current allocation overlap
  mismatches and conflicting dispositions fail closed. Composer retains departed
  debt and freezes payout/allocation evidence for stale approval. Nine new tests;
  focused 192/192, API typecheck/lint/build, formatting and Git whitespace pass.
  Changed void/reversal/cash/input resolvers and void/composition tests. Logs:
  `/tmp/cp005-void-return-{tests,types,lint,build}.log` and saved exit markers.
  All DB operations remain paused: no DB access, migrations, activation, deployment
  or browser acceptance. Tests used disabled dotenv and unusable loopback DB URL.
  Supplied records do not prove settlement timing/authenticity, historical allocation
  sale-line identity, complete cash inventory or prior/cross-workflow exclusivity.
  Next: ordinary returned void/cancelled-settlement evidence and authoritative
  loaders, opening carry/settlement, scoped plan/fallback composition,
  persistence/locking, correction posting and API/UI acceptance. Partial/uncertain
  cash remains unavailable. Real transactional acceptance remains DB-blocked;
  do not mark CP-005 DONE or start CP-003A/CP-006.

- **October 29, 2026 — CP-005 no-cash sale-void checkpoint:** CP-005 IN PROGRESS;
  latest completed CP-004. Independent explicit NO_MOVEMENT evidence supports
  sale-line/collection void reversals with no cash subtraction. Reconciles complete
  supplied original/reversal inventory, identity, outlet, timing and exact source
  negation. Same-month original collections remain cash; void status is not payout
  proof. Composer preserves departed-staff debt, freezes disposition revisions and
  rejects stale approval. Refund/no-cash conflicts and incomplete/uncertain evidence
  fail closed. New `apps/api/src/services/payroll-close-voids.ts` and adjacent tests;
  reversal/input integration and composition regression. Ten new tests; focused
  183/183, API typecheck/lint/build, formatting and Git whitespace pass. Logs:
  `/tmp/cp005-void-{tests,types,lint,build}.log` and saved exit markers.
  All DB operations paused: no DB access, migrations, activation, deployment or
  browser acceptance. Tests use disabled dotenv/unusable DB URL. Supplied records
  do not prove cash disposition authenticity, complete inventories or absence of
  prior-month/cross-workflow refunds. No operational source behavior changed.
  Next: returned/cancelled-settlement void cash and authoritative loaders, opening
  carry/settlement, scoped plan/fallback composition, persistence/locking, correction
  posting and API/UI acceptance. Real transactional acceptance remains DB-blocked.
  Do not mark CP-005 DONE or start CP-003A/CP-006.

- **October 29, 2026 — CP-005 ordinary-sale refund checkpoint:** CP-005 IN PROGRESS;
  latest completed CP-004. Full service/product refund cash now reconciles supplied
  independent tender/settlement net/GST/gross, original sale-line allocations,
  historical staff splits and exact source reversals. Subtracts net once across
  split tenders; preserves four-decimal residuals and departed-staff debt. Composer
  checks derived cash assertions and freezes settlement/allocation revisions for
  stale approval. Unsupported partial refunds, collection/void effects, duplicate
  identities and cash/no-cash conflicts fail closed. New resolver/test at
  `apps/api/src/services/payroll-close-sale-refunds.ts` and adjacent test; integrated
  into reversal/cash/input composition. Thirteen new tests; focused 173/173,
  API typecheck/lint/build, formatting and Git whitespace checks pass. Logs:
  `/tmp/cp005-sale-refund-{tests,types,lint,build}.log` and saved exit markers.
  All DB operations remain paused: no DB access, migrations, activation, deployment
  or browser acceptance. Tests use disabled dotenv/unusable DB URL. Supplied-record
  validation does not establish complete funding, authentic settlement, inventory
  completeness or cross-workflow payout exclusivity. No operational source changes.
  Next: collection/void cash reconciliation and authoritative loaders, opening
  carry/settlement, scoped plan/fallback composition, persistence/locking, correction
  posting and API/UI acceptance. Real transactional acceptance remains blocked by
  DB pause. Do not mark CP-005 DONE or start CP-003A/CP-006.

- **October 29, 2026 — CP-005 non-cash reversal checkpoint:** CP-005 IN PROGRESS;
  latest completed CP-004. Explicit independent zero-money evidence permits
  redemption/value-spend/session-correction reversals without treating negative
  commission bases as cash refunds. Validates exact original source/operation,
  sale/outlet/date and full source lineage; missing/foreign/duplicate/mismatched
  records fail closed. Composer freezes operational revisions, rejects stale
  approval and retains departed-staff negative commission debt with zero cash.
  New resolver/tests in `apps/api/src/services/payroll-close-reversals.ts` and
  adjacent test; cash/input resolver integration and composition regression added.
  Ten new tests; focused 160/160, API typecheck/lint/build, formatting and Git
  whitespace checks pass. Logs `/tmp/cp005-reversal-{tests,types,lint,build}.log`
  and saved exit markers. Tests use disabled dotenv and unusable loopback DB URL;
  no database queries, migrations, activation, deployment or browser acceptance.
  Explicit all-database pause remains. Supplied records do not establish actual
  absence of payout, evidence authenticity or inventory completeness.
  Next: sale-line/collection cash reversal reconciliation and authoritative loaders,
  opening carry/settlement, scoped plan/fallback composition, persistence/locking,
  correction posting and API/UI acceptance. Real transactional acceptance remains
  blocked by DB pause. Do not mark CP-005 DONE or start CP-003A/CP-006.

- **October 29, 2026 — CP-005 refund cash checkpoint:** CP-005 IN PROGRESS;
  latest completed CP-004. Package/value-package refund cash now requires supplied
  independent payout identity/date/tender/net/GST/gross plus original collection
  allocation/sale-line and seller reconciliation. Exact net payouts subtract from
  staff/outlet/salon cash, preserving negative totals, original departed sellers
  and stable residuals. Explicit zero/NONE cancellation supported; reused sources,
  missing/mismatched/orphaned payouts fail closed. Composer accepts payout evidence,
  includes refund-only staff and rejects stale approval after payout revision changes.
  New service: `apps/api/src/services/payroll-close-refunds.ts`; integration in
  cash/input resolvers, 12 new refund/composition tests. Focused 150/150; API
  typecheck/lint/build pass (saved exits 0), formatting/whitespace pass. Logs:
  `/tmp/cp005-refund-{tests,types,lint,build}.log` and `.exit` markers.
  Tests used disabled dotenv and an unusable loopback DB URL; no DB queries or
  browser acceptance. No database operations, migrations, activation or deployment.
  All-database pause remains. Existing refund capture does not itself prove actual
  payout; independent settlement authenticity/completeness remains the loader's job.
  Next: generic reversal cash reconciliation and authoritative source/metric/payout
  loaders, opening carry/settlement, scoped plan/fallback composition,
  persistence/locking, correction posting and API/UI acceptance. Real transactional
  acceptance remains blocked. Do not mark CP-005 DONE or start CP-003A/CP-006.

- **October 29, 2026 — CP-005 SUM_INDIVIDUAL checkpoint:** CP-005 IN PROGRESS;
  latest completed CP-004. Non-DB group resolver derives totals from validated
  source lines using recipient selected rule/types/assignment outlets. Population
  includes all credited staff, departed/different-plan staff, fixed/excluded bases
  and negative earned corrections; exact four-decimal sums, no cash substitution.
  Retains selected rule/version and population staff/line IDs. Composer rejects
  mismatched amount/month/rule/scope assertions and uses derived SUM_INDIVIDUAL
  metrics in statements. Population changes invalidate stale approval. Recorded
  delegated population default in DECISIONS.md. Thirteen new tests cover resolver
  and complete selected-plan incentive integration. Combined focused tests 138/138,
  API typecheck/lint/build, Prettier and Git whitespace checks pass. Logs:
  `/tmp/cp005-group-final-{tests,types,lint,build}.log`. No database/browser
  acceptance run. No DB commands, migrations, routes, activation
  or deployment; explicit all-database pause remains.
  Next: refund cash reconciliation, authoritative source/metric loading, opening
  carry/settlement and scoped plan/fallback composition, persistence/locking,
  correction posting and API/UI acceptance. Real transactional acceptance blocked
  by DB pause. Supplied-record validation is not complete CP-005 acceptance.

- **October 29, 2026 — CP-005 cash-metric reconciliation checkpoint:** current
  CP-005 IN PROGRESS; latest completed CP-004. Added non-DB cash resolver deriving
  staff and salon/outlet net external collections from reconciled allocations and
  explicit historical allocation attribution. Uses existing four-decimal split/
  stable residual handling; excludes GST, never sums commission bases for cash.
  Package attribution must match captured staff/base/outlet; missing, foreign,
  orphaned or duplicate attribution fails closed. Collection-only departed staff
  enter required configuration selection. Composer checks caller staff and scoped
  SALON_CASH assertions against derived money, uses derived statement denominators,
  and freezes attribution/revisions so changed evidence rejects stale approval.
  Fourteen new tests; combined focused suite 125/125; API typecheck/lint/build
  exit 0. Logs `/tmp/cp005-cash-final-{tests,types,lint,build}.log`.
  Refund/reversal cash reconciliation and SUM_INDIVIDUAL explicitly unavailable;
  no silent zero refund or base-to-cash substitution. Empty supplied reconciled
  payment inventory permits zero, but does not prove authoritative completeness.
  Historical attribution authenticity, ordinary-line attribution/outlet policy,
  settled-payment inventory and refund loading remain the trusted loader's job.
  Next: refund reconciliation, SUM_INDIVIDUAL population/scopes, trusted loaders,
  opening carry/settlement, persistence/source-approval locks, correction posting
  and API/UI acceptance. All DB operations remain paused by explicit user choice;
  no migration, DB access, routes, activation or deployment. Real transactional
  acceptance remains blocked; these supplied-record validators are not CP-005 DONE.

- **October 29, 2026 — CP-005 composition/reconciliation checkpoint:** current
  task CP-005 IN PROGRESS; latest completed CP-004. User explicitly retained the
  all-database pause when asked about disposable CP-005 acceptance. No database
  operations, migrations, activation or deployment performed.
  Added internal non-activating services/tests for independent operation/capture
  inventory matching, external payment/collection/GST/package-base reconciliation,
  next-open correction-period selection and combined close-input assembly.
  Required staff now derive from activity, frozen debt and manual amounts before
  configuration selection; missing carry/metrics/inventory blocks usable inputs.
  Composition tests include departed staff, exact fallback debt, preserved manual
  adjustments and complete-evidence stale approval checks. Allocator retains period
  revisions but does not post corrections or implement transactional locking.
  These validate supplied records, not authoritative inventory completeness or
  actual provider settlement. Metric attribution, refunds/scoped group totals,
  audited opening carry, carry settlement/mapping and full outlet composition
  remain unaccepted. No route, UI or persistence schema added.
  Next: implement trusted complete loaders, collection metric/refund allocation,
  opening carry/settlement policy, persisted immutable closes/audit and shared
  source/approval locking, actual correction posting and API/UI acceptance.
  Real migration/rollback/retry/race acceptance is blocked by the explicit DB pause;
  code work also remains. Do not mark CP-005 DONE or start CP-003A/CP-006.
  Verification logs: `/tmp/cp005-final-{tests,types,lint,build,shared}.log`;
  focused tests 111/111, shared tests 298/298, API typecheck/lint/build all exit 0.
  Prettier and Git whitespace checks pass. No database or browser acceptance run.

- **October 28, 2026 — CP-005 legacy exclusion checkpoint:** non-DB resolver
  checks candidate and lineage sales against supplied legacy commission records.
  Paid, unpaid, zero, unreleased and offsetting reversal overlaps fail closed;
  null sale identity and reconciliation-required rows also block. No netting,
  deletion or historical rewrite. Sorted exact-money evidence is retained and
  detached. Eight new tests; focused legacy/source/carry/config/close/preview/
  statement tests 75/75; API typecheck/lint/build pass. Test log:
  `/tmp/cp005-legacy-final-tests.log`. CP-005 remains IN PROGRESS; CP-004 latest
  completed. This validates supplied records only, not authoritative inventory
  completeness, immutable DB evidence or actual legacy payout disablement.
  Next: authoritative inventory and legacy exclusion integration, collection
  reconciliation, complete carry/required-staff loading, corrections, persistence/
  locks and API/UI/transactional acceptance. CP-003A/CP-006 remain TODO.
  No DB commands, migrations, routes, activation or deployment; CP-005 database
  authorization remains absent.

- **October 28, 2026 — CP-005 frozen carry evidence checkpoint:** internal non-DB
  resolver requires the immediately previous approved close and replays frozen
  calculation inputs/audited adjustments to check snapshot consistency. Retains
  prior close ID/revision/approval/calculation, stable component bases/units and
  exact fallback commission debt, plus required departed/disabled staff with debt.
  Missing prior close is UNAVAILABLE, never assumed zero; draft, cross-salon,
  wrong-month, invalid timing and inconsistent snapshots fail closed. Results are
  detached copies. Focused carry/source/config/close/preview/statement tests 67/67;
  API typecheck/lint/build exit 0. Logs `/tmp/cp005-carry-{tests,lint,build}.log`.
  CP-005 remains IN PROGRESS; CP-004 latest completed. This checks supplied records,
  not authenticity, DB immutability or authoritative inventory completeness. Opening
  carry policy, DB carry loading, source/collection reconciliation, required-staff
  integration, correction allocation, persistence/locks/API/UI and transactional
  acceptance remain. Unknown calculation versions fail closed. No database commands,
  migrations, routes, activation or deployment; CP-005 DB authorization still absent.
  Next: source inventory/legacy exclusion and collection reconciliation, then complete
  carry loading and required-staff integration. CP-003A and CP-006 remain TODO.

- **October 28, 2026 — CP-005 source evidence resolver:** internal non-DB
  validation retains complete candidate events/lineage, exact credited lines and
  required staff IDs. Missing/released/foreign-currency evidence, date/outlet/type
  mismatches, duplicate staff/lines and PAID/REVERSED inputs fail closed. Reversals
  require original-event identity and exact staff/base/unit/fixed-award negation;
  they are additive negatives, not edits to approved history. Zero/NONE cancellation
  may contain no lines; empty positive refunds are blocked. Focused source/config/
  close/preview/statement tests 57/57 (15 new source cases); API lint/typecheck/build
  exit 0. Logs `/tmp/cp005-sources-{tests,lint,types,build}.log`.
  Current task CP-005 IN PROGRESS; latest completed CP-004. Resolver does not prove
  source inventory completeness, operational reconciliation, legacy payout exclusion,
  authoritative collection/carry or next-open-period allocation. Those plus
  persistence/locking/API/UI/transactional acceptance remain. No DB commands,
  migrations, routes or activation; CP-005 database authorization still absent.

- **October 28, 2026 — CP-005 configuration resolver:** internal non-DB resolver
  selects month-end assignment/version and historical pre-close staff/profile/salon
  audit. Retains selected audit payloads/revisions; accepts stage override zero;
  includes disabled staff in the supplied activity/carry/owed set. Missing salary,
  classification, identity or ambiguous plans yield UNAVAILABLE/null configuration,
  never defaults or partial payroll. Cross-tenant/duplicate records fail closed.
  Focused configuration/close/preview/statement tests 42/42 pass (17 new resolver
  tests, including close/hash integration). API lint/typecheck/build, formatting
  and git diff whitespace checks exit 0. Logs `/tmp/cp005-configuration-final-tests.log`
  and `/tmp/cp005-config-verified.json`. No routes, DB commands or activation.
  Current task CP-005 IN PROGRESS; latest completed CP-004. Next: authoritative
  source/collection/carry loader and persistence/locking/correction allocation;
  API/UI and transactional acceptance still required. CP-005 DB authorization is
  still absent; existing CP-004 authorization remains narrowly scoped.

- **October 28, 2026 — CP-005 IN PROGRESS:** non-activating statement/close-state
  foundation implemented. Exact-money salary/manual components, collection KPI,
  complete copied inputs/results, revision/hash stale approval checks, preserved
  adjustments, own-statement/verified-owner reads and separate payout transitions.
  Shared 298/298; focused statement/close 18/18; close/preview API 17/17;
  shared/API typecheck and lint pass. No DB commands, migrations, routes or UI added.
  Remaining: authoritative source/config/profile/collection/carry loader; persisted
  close and immutable audit/snapshots; source/approval locking; next-open-period
  correction allocation; API/UI; real transactional/HTTP/race acceptance. Existing
  CP-004 disposable DB authorization does not authorize CP-005 DB work. Current task
  CP-005; most recently completed CP-004; next resume CP-005, not CP-003A/CP-006.

- **October 28, 2026 — CP-004 DONE:** owner separately authorized isolated
  disposable-database acceptance only. Fresh PostgreSQL 18 `/tmp` cluster on
  127.0.0.1:55476, 63 migrations; targeted lifecycle/rollback/audit/HTTP/isolation/
  competing-operation acceptance 18/18 on three runs. Route/helper regression
  210/210; shared 290/290; full serial web 963/963; API/web typecheck/lint/build pass.
  Cluster stopped. Current task: None; most recently completed: CP-004. Next ready:
  CP-005 (subsequently started above); CP-003A follows CP-005. Application/production DBs remain
  off-limits; no activation/deployment/commit/push. Earlier blockers below are history.

- **October 28, 2026 — CP-004 consistency/void checkpoint:** shared read/write
  source validation, missing debt/source preview guards, reversed-line rejection,
  fresh EARNED refund bases and purchase-void boundary tests implemented. Expanded
  non-DB API 148/148; focused UI 57/57; shared 290/290; API/web typecheck/lint and
  API build pass. CP-004 remains IN PROGRESS, completion BLOCKED by mandatory real
  transactional/POS/rollback/race acceptance under the retained DB pause. Latest
  request to continue until done did not explicitly lift that safety pause. No DB
  work or full-suite/browser acceptance. CP-005 unstarted; CP-003A TODO after CP-005.

- **October 28, 2026 — CP-004 collection ingestion seam:** 22 new non-DB cases
  run real collection capture/payroll-source/detail/refund services against local
  transaction doubles. Focused API 116/116; API typecheck/lint pass. No runtime code
  changes. Recorded cash/card/later-payment sources, exact GST residuals, retries
  and post-refund refusal covered. Payment recording endpoints/gateway settlement,
  SQL isolation/rollback/races and detail eligibility consistency remain unverified.
  CP-004 IN PROGRESS; DB pause holds; CP-005 unstarted; CP-003A TODO after CP-005.

- **October 28, 2026 — CP-004 value source evidence:** 21 new multi-collection/
  split-seller cases; focused API 94/94, API typecheck/lint/build pass. Fixed
  query-order-dependent rate selection by rejecting positive payouts with missing/
  differing original seller rates. Consistent rates and zero-payout cancellation
  remain supported. In-memory sources do not prove payment ingestion/settlement,
  SQL isolation or rollback/races. CP-004 IN PROGRESS; all DB work paused. CP-005
  unstarted; CP-003A TODO after CP-005.

- **October 28, 2026 — CP-004 value HTTP boundaries:** 41 new real HTTP/router/
  authentication/validation cases with in-memory Prisma replacements pass; combined
  focused API 73/73, API typecheck/lint pass. No runtime changes or DB access. Tests
  establish route guards/scope propagation, NOT SQL isolation or transaction safety.
  CP-004 IN PROGRESS: broader source/mixed-tender cases and mandatory real DB
  lifecycle/rollback/race acceptance remain. All DB work paused. CP-005 unstarted;
  CP-003A TODO after CP-005.

- **October 28, 2026 — CP-004 value-refund detail/UI:** customer-bound read endpoint,
  strict evidence contract and prepaid economics/refund dialog implemented. Exact
  ratio/fee/GST preview, actual tender, confirmation, zero/NONE and stale/pending/
  role/read-only guards covered. Focused web 55/55; non-DB API 32/32; shared 290/290;
  typechecks/lint/web build pass. Full web 958/959, PayrollPlans timeout; isolated
  23/23 rerun passes. No DB work. CP-004 IN PROGRESS; real HTTP and DB rollback/race
  acceptance remain. CP-005 unstarted; CP-003A TODO after CP-005. Database pause holds.

- **October 28, 2026 — CP-004 value-refund service:** guarded endpoint and atomic
  service code, source/usage validation, original-seller negative bases, cancellation,
  retry handling and collection/void-restoration guards implemented. Non-DB doubles
  26/26, shared 287/287; API typecheck/lint/build pass. No DB operation. CP-004 stays
  IN PROGRESS: UI, HTTP authorization acceptance and real rollback/race/lifecycle
  tests remain. CP-005 unstarted; CP-003A TODO after CP-005. All DB work paused.

- **October 28, 2026 — CP-004 value-refund foundation:** exact original paid/credit
  arithmetic and validated purchase contract implemented; ten new tests, shared
  287/287, workspace typechecks/lint pass. No refund endpoint/UI integration or
  database work. CP-004 IN PROGRESS; source validation, atomic cancellation/retry
  and database lifecycle/race acceptance remain. CP-005 unstarted; CP-003A TODO
  after CP-005. Database pause must be separately lifted before acceptance.

- **October 28, 2026 — CP-004 session-action UI increment:** strict exact refund
  input, revision-bound correction drafts/void keys and synchronous pending guard
  implemented. Detail UI 27/27; full web 940/940 across 107 files and web
  typecheck/lint/build pass. All DB work remains paused. CP-004 stays IN PROGRESS;
  value-package refunds and transactional lifecycle/race acceptance remain open.
  CP-005 unstarted; CP-003A remains TODO after CP-005.
- **October 28, 2026 — authorized CP-004 implementation, DB pause preserved:**
  zero-payout cancellation, refund validation/original-award clawback, FOC full-list
  capture and once-per-sale-line fixed award handling implemented. Shared 277/277,
  full web 921/921, non-DB PIN HTTP 6/6, typechecks/lint and API/web builds pass.
  Expanded DB lifecycle assertions NOT RUN. CP-004 remains IN PROGRESS: paused
  transactional/race acceptance and value-package refund work still prevent DONE.
  CP-005 unstarted; CP-003A TODO after CP-005. No database operation authorized/run.
- **October 28, 2026 — refund/economics review continued without DB:** zero-payout
  rejection and FOC price/mixed-credit findings confirmed by static inspection;
  fixed-award quantity semantics remain unresolved. Shared 267/267, focused web
  25/25, workspace typechecks/lint pass. No behavior changes or DB operations.
  CP-004 remains IN PROGRESS; lifecycle acceptance is paused. CP-003A stays TODO
  after CP-005. Detailed findings and remaining checks are recorded below.
- **October 28, 2026 — PIN limiter fix authorized and verified without DB:**
  checkout without an unpaid-session override now bypasses the approval limiter,
  including when its tenant/operator budget is exhausted. Real HTTP middleware
  tests 6/6, API typecheck and lint pass. Concurrent failed approvals retain the
  ten-request budget across create/complete and manager changes. All DB work stays
  paused. CP-004 remains IN PROGRESS; next unresolved refund/economics and lifecycle
  acceptance work is not started by this increment. CP-003A remains TODO after CP-005.
- **October 28, 2026 — non-database review authorized:** user permits CP-004 code
  review and non-database checks only. All database work remains paused, including
  disposable acceptance. Working tree was clean at review start. Shared build,
  shared tests 267/267, focused web 25/25 (four files), workspace typechecks and
  lint pass. No API/database tests, migrations, activation or application edits.
  Next: resolve the findings below once implementation is authorized; database
  acceptance still requires separate approval. CP-004 remains IN PROGRESS.
- **STOP / safety incident, October 28, 2026:** CP-004 remains IN PROGRESS.
  An incorrectly targeted `npm run db:migrate` applied 12 pending migrations to
  the configured local application database `glampro_suite` at `localhost:5432`.
  No automatic rollback attempted. Owner review is required before further database
  work. Log: `/tmp/cp004-lifecycle-unsafe-migrate-notrun.log` (despite its filename,
  the command DID execute successfully). Earlier no-application-write statements
  describe earlier checkpoints only, not this session.
- New lifecycle code is unfinished and must not be deployed. Latest workspace
  typecheck passed; earlier lifecycle/collection 2/2 and focused API 72/72 passed
  on a disposable DB before subsequent edits. Focused web 40/40 passed before
  latest detail/editor changes. No full regression/build/browser acceptance.
  Expanded lifecycle tests, concurrency, value refunds, legacy gaps, fixed award
  quantity handling, source evidence validation and complete UI acceptance remain.
  Do not mark CP-004 DONE; CP-005 remains unstarted. No earnings activation.

- Current task: CP-004 — IN PROGRESS. CP-003 configuration-only scope accepted.
- Most recently completed: CP-003 — DONE, October 28, 2026.
- Priority: this project before unrelated backlog. New requirements govern policy;
  existing authentication, tenant safety and exact-money integrity remain mandatory.
- Shared engine and CP-003 configuration accepted. CP-004 now captures rate-free
  package-sale collection facts and immutable holding purchase economics/settings atomically;
  not complete engine-ready inputs. Missing evidence remains explicit.
- Deferred to CP-003A: authoritative historical monetary inputs, frozen opening
  carry, scoped group metrics and preview/full-run equality. Depends on CP-004
  capture and CP-005 statements; remains a CP-007 must-have release gate.
- Latest CP-004 checks: disposable 60-migration replay, shared 265/265, collection
  integration 1/1 (including settings concurrency/rollback), focused API 68/68,
  focused web 30/30, workspace typechecks/lint pass. Disposable PostgreSQL stopped.
- Next: resume CP-004 redemption integration, integrate captured session values
  into redemption, deposit/paid-session gates and verified PIN override; then
  remaining capture/refund/correction paths.
  CP-005 not started. Historical money unavailable; activation prohibited.
- Existing unrelated sale UI work is preserved and is not accepted as CP completion.

## October 28, 2026 — CP-004 completion: explicitly authorized disposable acceptance

- Authorization: user selected “Authorize isolated disposable-database CP-004
  acceptance only; keep application/production databases untouched.” This narrowly
  supersedes the all-DB pause for these tests only. Did not read application `.env`,
  connect to localhost:5432, repair/rollback the earlier incident, activate or deploy.
  Every DB command supplied explicit loopback 55476/database parameters or an
  explicit DATABASE_URL with DOTENV_CONFIG_PATH=/dev/null. Synthetic credentials only.
- Created fresh PostgreSQL 18 cluster `/tmp/cp004-authorized-pg-vxsZJf/data`, verified
  current_database/server address/port/data_directory before replaying all 63
  migrations into `commission_collection_test`. No seed/import of application data.
  Cluster stopped cleanly; port 55476 confirmed no longer listening. Data retained
  only in disposable `/tmp` location; pointer `/tmp/cp004-authorized-pg.path`.
- New `apps/api/src/services/payroll-value-lifecycle.acceptance.test.ts` runs real SQL
  purchase/spend/refund/detail/void/transfer/collection and HTTP routers. Tests mixed
  cash/card purchase, paid-to-credit ratio/original GST, earned-spend preservation,
  injected full/partial-debt rollback (holding/revision/event/debt/trigger balance
  evidence), identical concurrent/conflicting retries, duplicate refund refusal,
  tenant-scoped reads, append-only event update/delete refusal, zero/NONE cancellation,
  actual payout tender, role loss and tenant-claim mismatch through real HTTP.
- Value race cases: distinct refunds, spend/refund, transfer/refund, later payment/
  refund. Assertions reconcile final credit/owner/debt/payment/refund counts, not
  merely Promise rejection. Real trigger balance evidence retains actor/reason and
  purchase sale, once only. Added prepaidSaleContext before refund holding updates
  to fix missing purchase-sale linkage in balance-event audit evidence.
- New `apps/api/src/services/payroll-session-races.acceptance.test.ts` covers exact
  50/50 2,000 deposit/3,000 balance and -1,450 each on 2,900 refund (TC09/12), keeps
  earned redemption sources, required sellers checkout rollback (TC18), and competing
  redemption/refund, transfer/refund, session-void/refund and payment/refund. Existing
  lifecycle verifies paid-session gate/PIN audit, catalogue immutability, correction,
  fixed clawback/quantity behavior, transfer originals, VP_SPEND ratio and FOC snapshot.
- Applied fresh EARNED status and REVERSED-source refusal to session refunds too;
  newly recorded negative evidence never inherits PAID historical status. Existing
  fixed-award lifecycle and new follow-plan split/race acceptance pass afterward.
- Verification: four real disposable suites **18/18**, no skips, repeated three
  times; `/tmp/cp004-authorized-final-{1,2,3}.{log,exit}` all exit 0. Additional real
  sales/customer route + HTTP/double/helper regression **210/210**, no skips,
  `/tmp/cp004-authorized-regression.{log,exit}`. Full web one worker **963/963** across
  108 files, `/tmp/cp004-authorized-web.{log,exit}`; this run supersedes earlier
  PayrollPlans timeout, without asserting the earlier run passed. Shared **290/290**.
  API/web typecheck/lint/build pass; logs `/tmp/cp004-authorized-{types,lint,build,
web-build}.*` and `/tmp/cp004-consistency-*`. Formatting/whitespace checked at handoff.
- Acceptance scope: real SQL/POS service and HTTP plus component/full-web tests,
  not exhaustive scheduler interleavings, external gateway settlement, full API
  repository regression or browser release walkthrough. No EmployeeCommission rows
  created. FR-POS-09/MTD belongs to CP-006; browser/release acceptance remains CP-007.
  Differing historical value seller rates still intentionally require reconciliation
  per DECISIONS; no arbitrary rate-lot allocation added.
- CP-004 DONE against its practical completion checks. Next ready: CP-005 monthly
  close/frozen statements, NOT STARTED. CP-003A remains TODO after CP-005. No commit,
  push, activation or deployment. Application/production DB restriction still holds.

## October 28, 2026 — CP-004 consistency, negative-line status and void boundary

- User requested continuing until CP-004 done. Reviewed the full CP-004 completion
  check: real disposable DB/POS TC-09–12/16–18, rollback/retries and payment/spend/
  refund/transfer races remain mandatory. Existing pause explicitly requires separate
  authorization, so no DB access, generation, migration, activation, deployment,
  commit or push. Preserved existing working-tree changes and unrelated `.kilo/`.
- Extracted `apps/api/src/services/payroll-value-collection-sources.ts` from the
  refund writer, retaining original lineage/split/mode/outlet/base/rate checks.
  Both refund and detail use it; REVERSED original lines are refused. Detail keeps
  known totals but returns ORIGINAL_COLLECTION_SELLER_SOURCES for invalid sources
  and ORIGINAL_OUTSTANDING_BALANCE for missing/insufficient cancellation debt. UI's
  existing missingEvidence gate blocks submission, now with two specific regressions.
- Eight detail cases cover missing/wrong seller/base/rate/unavailable/reversed
  sources, conflicting multi-source rates and debt absent/short/exact. New negative
  refund lines explicitly start EARNED rather than inheriting PAID from an original
  historical source; three status regressions cover EARNED/PAID/REVERSED. Original
  evidence stays untouched. This is pending evidence, not earnings activation.
- Two tests call actual `voidSale` with local Prisma replacements to verify both
  PACKAGE_REFUND and VALUE_PACKAGE_REFUND refuse before status/ledger/credit reversal.
  Serialization touch still occurs inside the double; SQL rollback is NOT proven.
  No transaction rollback or concurrency claim follows from these tests.
- Expanded non-DB API (HTTP/value collection/detail/refund/void plus pure collection/
  valuation helpers) **148/148**; focused UI **57/57**; shared **290/290**. API/web
  typecheck/lint and API/shared build exit 0. Logs/exit markers
  `/tmp/cp004-consistency-{tests,web,shared,types,lint,build,web-types,web-lint}.{log,exit}`.
  Initial two new UI assertions were ambiguous because several amounts were equal;
  fixed by asserting the original-paid-net description specifically; rerun passes.
- Known limitation: detail evaluates source-rate eligibility with zero admin fee;
  it conservatively blocks conflicting rates even if a future fee could reduce
  payout to zero. Do not infer positive payout eligibility from money alone.
- CP-004 IN PROGRESS, completion blocked. No exhaustive non-DB completion claimed;
  mandatory real SQL lifecycle/rollback/audit/isolation/race and POS/browser acceptance
  cannot be substituted by more doubles. Next action requires owner decision on
  isolated disposable DB acceptance authorization; keep application DB untouched.
  If pause remains, preserve this checkpoint. CP-005/CP-003A must not start.

## October 28, 2026 — CP-004 collection ingestion service seam

- Rechecked working tree and latest handoff; continued CP-004 only. Preserved
  unrelated changes including the untracked `.kilo/` directory. Added
  `apps/api/src/services/payroll-value-collection.test.ts` and tracking notes only.
  No runtime code edits, DB operations, generation, commit, push or deployment.
- New **22/22** non-DB cases use the actual `captureCollectionEvidence`,
  `capturePayrollCollection`/`appendPayrollSource`, value detail and refund services.
  Every persistence method is a local transaction-double method; tests do not call
  Prisma client queries. Inputs are recorded payment-row doubles, NOT endpoint or
  gateway payment creation. Two original split sellers keep source-time 7/9 rates.
- Verifies cash/card/later outstanding-payment lookup lineage, exact original net/
  GST allocations and first-collection-only sale units, detail totals and generated
  sources accepted by refund. Refund preserves captured sources and pays using
  independently recorded PAYNOW tender. Unequal 0.06/0.06/544.88 receipts consume
  cumulative GST residual exactly (0/1/4499 tax cents), retaining the same payout.
- Rejects PACKAGE/PREPAID_CREDIT, gateway session, missing/zero source, client amount
  mismatch, outstanding parent tenant/sale/customer mismatch, other-customer source,
  void/refunded sale, wrong sale/prior-collection currency, foreign line allocation,
  overcollection and missing tenant scope. Identical retry preserves writes and units;
  conflicting retry fails. After an actual in-memory capture/refund flow, collection
  refuses before looking up the proposed new receipt and adds no write intent.
- Combined focused collection/HTTP/detail/refund API **116/116**, no skips. API
  typecheck/lint **exit 0**. Logs and exit markers:
  `/tmp/cp004-value-ingestion-{tests,types,lint}.{log,exit}`. Formatting/whitespace
  checked separately. No full API/web tests or build rerun in this test-only increment.
- Limits: no SQL query isolation, real transaction rollback, audit persistence,
  gateway settlement, payment-creation endpoint or concurrent lifecycle acceptance.
  Local write arrays prove intent/order only. Detail still validates economics/usage
  but does not guarantee complete refund seller-source/rate eligibility; write
  independently revalidates. This remains a specific follow-up, not a completed gate.
- CP-004 IN PROGRESS. Next within pause: detail/write eligibility consistency and
  payment recording endpoint or post-refund void/restoration seams. Mandatory real
  disposable-DB lifecycle/rollback/retry/payment/spend/refund/transfer races remain
  blocked until separate authorization. CP-005 unstarted; CP-003A TODO after CP-005.

## October 28, 2026 — CP-004 multi-collection source evidence

- Rechecked actual working tree before edits and continued CP-004 only. No DB
  commands, queries, migrations, generation, deployment, activation, commit or push.
- Added 21 refund service cases in `apps/api/src/services/payroll-value-package-refund.test.ts`:
  three already-recorded allocations representing cash/card checkout and later
  outstanding payment, original 60/40 sellers (distinct 7/9 source rates), read/write
  economics agreement, payout tender independent of original source, source-order/
  seller-order invariance, each missing source, conflicting/missing/equal-format
  rates, partial debt cancellation, aggregate overcollection, corrupt later source
  sale/currency/status/sellers/kind/mode/outlet/base, fully used zero/NONE cancellation.
- Reproduced two failing cases before the fix: conflicting recorded rates were
  accepted in either source order. Refund used the first returned row per seller,
  without an ordering or rate-consistency guarantee. Updated only
  `apps/api/src/services/payroll-value-package-refund.ts` to reject positive payouts
  with missing or numerically differing historical rates before any write. Uses
  installed Prisma Decimal for rate comparison, not floating-point money. No current
  rules/catalogue lookup. See DECISIONS for conservative limitation; no implicit
  rate-lot allocation invented. Zero payout keeps no negative lines.
- API focused HTTP/detail/refund **94/94**, no skips. API typecheck/lint/build
  (including shared TypeScript build) **exit 0**. Logs and exit markers:
  `/tmp/cp004-value-source-{tests,types,lint,build}.{log,exit}`; pre-fix failure
  `/tmp/cp004-value-source-before.log`. No full API/web suite or real SQL test run.
- Limits: fixtures start at recorded collection allocations. They do NOT establish
  mixed-tender payment ingestion, gateway settlement, query isolation, atomicity,
  rollback, audit or concurrency. Detail still previews economic/usage evidence;
  write independently rejects missing/conflicting rate sources. Such a preview is
  not approval of refund eligibility. Differing-rate positive refunds intentionally
  require reconciliation until an explicit rate-lot policy is implemented/tested.
- CP-004 remains IN PROGRESS. Next within DB pause: inspect/test payment-source
  ingestion and detail/write evidence consistency plus post-refund lifecycle guards.
  Mandatory disposable-DB lifecycle/rollback/retry/payment/spend/refund/transfer
  races remain blocked pending separate authorization. CP-005 unstarted;
  CP-003A TODO after CP-005; do not advance automatically.

## October 28, 2026 — CP-004 value-package HTTP boundary verification

- Resumed CP-004 only. Preserved all prior uncommitted work. Added only
  `apps/api/src/routes/payroll-value-package.http.test.ts` and tracking updates;
  no application behavior, migrations, generation, activation, deployment, commit
  or push. Every database operation remains paused.
- Test mounts the real customers/sales routers with JSON parsing and the production
  error handler on an ephemeral loopback HTTP server. Uses real access-token signing/
  verification, auth/session checks, outlet, entitlement, writable-tenant, current
  role and strict request validation middleware plus real detail/refund services.
  Prisma auth/entitlement lookups and transaction entry are replaced in memory;
  proxy delegate methods are restored afterward. Transaction double has only the
  expected operations; no real Prisma query executes. Run disables dotenv, supplies
  synthetic JWT signing material and an unusable database URL. No credentials saved.
- New HTTP **41/41**: manager zero/NONE and verified owner success; missing/invalid/
  revoked/disabled session and platform realm refusal; tenant-claim mismatch and
  ignored spoofed tenant header; active/foreign/suspended/invalid outlet handling;
  current STAFF/CASHIER role overrides privileged token claims; suspended tenant
  reads but cannot write; absent/expired packages grant refusal; owner 2FA refusal;
  current-customer read binding and missing holding; strict money/tender/reason/date/
  extra-tenant-field refusal; stale holding and exact payout mismatch responses.
- Verified downstream tenant/actor/outlet AsyncLocalStorage context. This is scope
  propagation evidence, NOT PostgreSQL query isolation or cross-tenant row security.
  In-memory successful writes are intent checks, NOT atomicity/audit/rollback proof.
- Combined HTTP + value detail/refund service tests **73/73**, no skipped cases.
  API typecheck and lint **exit 0**. Logs `/tmp/cp004-value-http-{tests,types,lint}.log`
  and adjacent exit markers. No full API/database suite, web suite/build, browser or
  real transactional race run in this increment; previous UI verification stands.
- CP-004 remains IN PROGRESS. Next within pause: broaden original-source evidence,
  split sellers, multi-payment and mixed-tender fixtures and inspect other lifecycle
  boundaries. Mandatory real disposable DB rollback/retry/payment/spend/refund/
  transfer race/lifecycle acceptance still requires separate owner authorization.
  CP-005 unstarted; CP-003A TODO after CP-005. Do not deploy unfinished lifecycle.

## October 28, 2026 — CP-004 value-package detail and refund UI increment

- Resumed CP-004 only and preserved all previous uncommitted changes. Database
  pause retained: no database operations/tests, migrations, generation, disposable
  cluster, activation, deployment, commit or push.
- Added `payrollValueHoldingDetailSchema` in the shared holding contracts, with
  three contract tests. Explicit nullable legacy economics, exact cent/tick strings,
  purchase ratio and recorded refund distinguish unavailable evidence from zero.
- Added `apps/api/src/services/payroll-value-holding-detail.ts` plus six in-memory
  read tests. `GET /customers/:id/prepaid/:holdingId/payroll` uses authenticated
  customers/packages guards and a repeatable-read transaction. Lookup includes
  current customer and holding identity; tenant scoping remains the existing Prisma
  boundary. Reconciles source line/sellers, GST, collections and active used credit.
  Missing/corrupt evidence disables preview; recorded refund comes from its immutable
  event rather than incorrectly recalculating used value from cancelled credit.
- Added `ValuePackagePayrollDetail.tsx` and a prepaid ownership-panel entry point.
  Shows paid versus promotional credit, collections, original sellers and four-decimal
  used value. Manager/owner controls compute the shared exact fee-based preview,
  require reason/explicit confirmation, select actual payout tender, and send zero
  as NONE. Labels disclose recorded payout, no provider transfer/earnings activation,
  provisional preview and server-side revalidation. Existing write independently
  validates source-time payroll collection lines and outstanding debt; this preview
  does not assert that those write-side checks have passed.
- Revision-bound form resets approval and retry key on refreshed holding evidence.
  Unchanged refused requests retain retry key/draft but clear confirmation; pending
  ref prevents duplicate writes. Background refresh, role/read-only loss, malformed
  fees, missing evidence and recorded refund block submission.
- Checks: focused web **55/55** across value detail (20), session detail (27), and
  prepaid panel (8). API transaction-double/read tests **32/32**, with dotenv disabled
  and unusable DB URL; no real Prisma queries. Shared **290/290**. Workspace typechecks,
  lint and web production build pass. Logs `/tmp/cp004-value-ui-{web,api,shared,types,lint,build}.log`
  and adjacent exit markers; terminal-wrapper errors were checked against actual logs.
- Full web run: **958/959**, 107/108 files pass. Unchanged PayrollPlans metadata-save
  test exceeded its existing 5000ms timeout under parallel load. That complete suite
  rerun alone passes **23/23** without assertions/timeouts being modified. Do not claim
  a clean full-suite pass. Full run preceded the final two focused guard tests.
- CP-004 remains IN PROGRESS. Next: real HTTP authorization/tenant/outlet and broader
  multi-payment/mixed-tender/source acceptance coverage, then mandatory disposable
  DB rollback/retry/payment/spend/refund/transfer race and full lifecycle acceptance
  only after separate DB authorization/owner review. No transactional safety, actual
  SQL/audit behavior or browser walkthrough accepted here. CP-005 unstarted; CP-003A
  TODO after CP-005. Do not advance those tasks or deploy this unfinished lifecycle.

## October 28, 2026 — CP-004 value-package refund service increment

- Resumed CP-004 only. Preserved the previous uncommitted shared arithmetic and
  tracking changes. No DB access, migration, generation, disposable cluster,
  activation, deployment, commit or push. New code is not release acceptance.
- Added `apps/api/src/services/payroll-value-package-refund.ts` and focused tests.
  New `POST /sales/value-package-holdings/:id/refund` uses the existing strict
  refund request contract and auth, sales/packages modules, writable-tenant and
  manager/owner route guards. Service independently validates enabled manager/owner
  and tenant actor, takes prepaid then configuration locks, and validates retry hash.
- Reconciles immutable purchase IDs/currency/paid/credit/sellers with source line,
  original GST, active redemption amounts, collection components and source-time
  VP_SALE seller lines. Rejects stale/incomplete/conflicting evidence before writes.
  Copies original rate evidence instead of resolving current rates. Appends a
  PENDING_RELEASE refund event, zeros remaining credit and decrements only original
  uncollected debt in the transaction; zero cash writes no commission lines.
- `sale.service.ts` refuses credit restoration after value refund and original-sale
  void after either package refund type. `commission-collection-evidence.ts` refuses
  new allocations to refunded value holdings; `payroll-source-event.ts` excludes
  value refund events from generic reversal. Earned spend events remain unchanged.
- Tests use an entirely in-memory transaction double and the internal service seam,
  with dotenv disabled and an unusable database URL. No Prisma query executes.
  **26/26** pass: payout/seller/rate evidence, partial/zero collection cancellation,
  stale/legacy/corrupt evidence refusal, roles/scope, identical/conflicting retries,
  second-key refusal, debt consistency, restoration and collection guards. These
  do NOT establish DB rollback, tenant query isolation, races or HTTP authorization.
- Full shared suite **287/287**; API typecheck, lint and build pass (shared build
  via API prebuild). Logs `/tmp/cp004-value-service-{tests,shared,types,lint,build}.log`
  and adjacent `.exit` markers. Terminal integration may report wrapper closure;
  actual summaries and saved command exits were checked.
- Remaining: value-holding detail/refund UI and exact quote/read contracts; real
  HTTP role/tenant/outlet checks; original source reconciliation with multi-payment
  and mixed-tender fixtures; rollback/retry/payment/spend/refund/transfer races,
  refund/void behavior and complete lifecycle acceptance. The service's transaction
  correctness and SQL/audit behavior remain unverified until separately authorized
  disposable database acceptance. No deployment or earnings activation permitted.
- CP-004 IN PROGRESS. Next: value-refund detail/UI integration within the DB pause.
  CP-005 unstarted; CP-003A TODO after CP-005. Do not start either automatically.

## October 28, 2026 — CP-004 value-package refund arithmetic foundation

- User requested continuing CP-004 to completion while keeping all DB work paused.
  Kept that safety boundary: no DB command, migration, client generation, disposable
  cluster, API acceptance, activation, deployment, commit or push. CP-004 cannot
  satisfy its mandatory real transactional completion check during this pause.
- Added `packages/shared/src/commission-payroll/value-package-refund.ts` and its
  tests, exported through the shared barrel. Validates source-time purchase IDs,
  cent-exact paid/credit values, currency and original seller shares. Incomplete
  prospective evidence may be represented but is rejected for a refund quote.
- Uses the existing cumulative VP_SPEND ratio for used value, preserves four-decimal
  residuals, floors customer cash at zero, separates original GST and cancelled
  debt/face credit, and rejects negative/excess collections or remaining credit.
  Policy recorded in DECISIONS.md. Pure helper has no persistence or payout effects.
- Checks: shared build completed and full shared suite **287/287** (ten new cases);
  workspace typechecks and lint **exit 0**, confirmed by saved exit markers.
  Logs `/tmp/cp004-value-refund-{shared,types,lint}.log`. Terminal integration
  intermittently reported missing completion; actual test summary and type/lint
  exit-marker files were inspected rather than treating tool-wrapper errors as passes.
- This is a foundation, not the completed value-refund feature. Still required:
  endpoint/UI wiring; authoritative sale-line/tax/collection reconciliation; atomic
  original-seller negative base and remaining-credit/debt cancellation; stale/retry
  handling and prevention of credit restoration through voids after refund; real
  payment/spend/refund/transfer concurrency and rollback acceptance. Original earned
  spend evidence must remain untouched. None of these are claimed verified here.
- CP-004 remains IN PROGRESS. Next: continue its value-refund workflow within the
  database pause; owner review/separate authorization is required before any DB
  acceptance. CP-005 remains unstarted; CP-003A remains TODO after CP-005.

## October 28, 2026 — CP-004 session-action UI acceptance increment

- Resumed CP-004, not CP-005. Database pause retained, including disposable tests.
  Preserved all pre-existing API/shared/limiter/tracking changes. This increment
  changes only the package detail component, its tests and tracking documents.
- `apps/web/src/components/customers/PackagePayrollDetail.tsx` no longer uses the
  permissive till parser for approved refund/fee input: malformed, negative,
  exponent, whitespace and sub-cent input is rejected, not coerced/rounded to zero.
  Exact bigint conversion preserves explicit zero/NONE versus positive/CASH input.
- Correction drafts retain the session revision at editing time. A refreshed
  revision disables the old draft and resets the attribution editor instead of
  silently submitting stale staff choices against a new revision. Void keys now
  include action/session/revision; unchanged retries retain the same request.
- Added synchronous pending ref alongside rendered disabled controls to prevent
  duplicate/competing writes before React rerenders. Existing role/read-only gates
  and refund cancellation semantics are preserved. Earned session staff correction
  stays available after refund; restoring refunded sessions stays disabled.
- Detail component suite expanded from eight to **27 passing cases**, using the
  real attribution editor: reason and revision posting, valid staff selection,
  stale draft invalidation, unchanged void retry, duplicate clicks, pending action
  exclusion, malformed refund/fee, inactive/missing-revision/read-only/role guards,
  refunded restoration refusal and failed evidence reads. API calls are mocked;
  this is UI evidence, not server authorization or transactional acceptance.
- Web typecheck, lint and production build pass; shared build also passes through
  web prebuild. Full web **940/940** across 107 files with two workers passes,
  including all 27 detail cases. Formatting and diff whitespace checks pass. Logs:
  `/tmp/cp004-session-ui-{tests,types,lint,build,web}.log`; exit markers stored.
  No API/DB tests, migrations, activation, browser walkthrough, commit or push.
- CP-004 remains IN PROGRESS: value-package refund implementation and real
  transactional lifecycle/rollback/retry/race evidence remain. CP-005 not started;
  CP-003A remains TODO after CP-005. Any database work requires separate approval.

## October 28, 2026 — CP-004 authorized refund/source implementation

- User requested completion. Implemented local economic fixes without interpreting
  that request as lifting the explicit database pause. No DB access, migration,
  disposable cluster, activation, deployment, commit or push. Preserved pre-existing
  limiter/test and tracking changes. CP-004 remains IN PROGRESS, not accepted DONE.
- Shared `package-refund.ts` validates ordinal bounds/overlap/count and original
  collected net/tax limits, preserves exact four-decimal used value, floors net at
  zero, rounds only at customer cents, separates stored GST and cancelled debt.
  Refund and detail reads reuse the ordinal validator. Refund service validates
  source sale/holding lineage, collection components, unique captured source per
  allocation, exact original seller splits/modes/currency and outstanding debt before
  writes. Fixed clawback is based on captured awards, not inferred current prices.
- Request/UI now supports zero payout only with explicit NONE tender. Cancellation
  retains earned session sources and writes no payable/clawback lines at zero.
  Positive cash refund behavior is retained; neither path sends provider money.
- Service loading captures full nonmember list price independently of selected
  member price. FOC base ignores unrelated credit tenders; non-FOC external-tender
  evidence still fails unavailable when missing. No backfill/repricing of history.
- SRS wording checked directly from supplied DOCX: fixed dollars per sale versus
  per redemption session. Recorded per-source-sale-line interpretation, with line
  quantity separate from the fixed award. Prior collection count, not prior net,
  prevents repeating awards/units across zero-net instalments.
- Added ten shared arithmetic/contract tests and eight refund-detail UI cases for
  zero/positive payout tender, stale token, role/read-only/missing/refunded guards
  and server refusal. Initial UI tests used an ambiguous Sessions text selector;
  fixed to the accessible heading; all eight pass without changing product guards.
- Extended existing opt-in DB lifecycle assertions for quantity-two units/one fixed
  award, zero-payout idempotent cancellation and member FOC full-list snapshot.
  These assertions compile but **were not executed**. They do not establish race,
  rollback, mixed-credit POS or database-trigger acceptance.
- Verified: shared **277/277**; full web **921/921** across 107 files with two
  workers; isolated real HTTP PIN middleware **6/6**; workspace typechecks/lint,
  shared/API/web builds pass. Logs `/tmp/cp004-finish-*.log`; exit markers recorded
  separately. No full API run, database acceptance or authenticated browser run.
- Remaining completion gates: real transactional POS/API lifecycle rollback/retry/
  concurrent payment/redemption/refund/transfer evidence; value-package refund path;
  broader source/legacy/PIN/tenant isolation and complete session correction/void UI
  acceptance. CP-004 cannot be DONE from non-DB tests. Owner review/separate approval
  is required before any DB work; implementation can continue only within that pause.
- Next task stays CP-004. Do not start CP-005; CP-003A remains TODO after CP-005.

## October 28, 2026 — CP-004 refund/economics review continuation

- Scope: static review and non-database checks only. Preserved pre-existing PIN
  limiter/test and tracking edits. No economic implementation, database access,
  migration, disposable cluster, activation, deployment, commit or push.
- **Zero-payout cancellation:** `packages/shared/src/schemas/payroll-holding.ts`
  requires positive `payoutGrossCents`; `apps/api/src/services/payroll-package-refund.ts`
  also rejects zero net before cancelling sessions/reconciling outstanding debt.
  CP-D08 explicitly floors refund at zero, but the cancellation/tender evidence
  contract must be settled before implementation. Changing only the service guard
  cannot fix the request/UI path. Cover zero collected cash, used value/fees at or
  above collections, exact cent boundary, no provider payout, preserved earned
  redemption evidence, duplicate/conflicting retries and outstanding reconciliation.
- **FOC selected-price defect:** `priceLine` in `apps/api/src/services/sale.service.ts`
  selects member/nonmember pricing; the FOC branch later uses that selected
  `line.item.unitPrice` and labels it `listUnitPrice`. OP-2 requires full snapshotted
  list price. Capture its authoritative source independently; do not infer historical
  list prices from current catalogue values. The receipt-wide `creditPaid` branch
  can additionally replace an FOC base with external net or null. Verify FOC beside
  credit-funded paid services, partial package coverage, member pricing, quantity,
  GST, catalogue edits and one-time plan base/rate application.
- **Fixed award quantity unresolved:** `apps/api/src/services/payroll-source-event.ts`
  captures the configured award once per sale line on the first collection, while
  units include line quantity. Refund uses that same unmultiplied configured award
  against original purchase net. Current lifecycle purchase fixture uses quantity 1;
  it cannot resolve whether the award is per package unit or per sale line. Settle
  that unit explicitly, then test quantity >1, instalments, seller splits, full and
  partial refund, original-award ceiling and unchanged purchase-time settings.
- **Refund evidence validation gap:** refund parses ordinal ranges but does not
  normalize/check overlap or reconcile their count with `quantityRemaining`, unlike
  `drawPayrollPackageSessions`. Before computing money, acceptance must reject
  contradictory ranges/counts, negative/over-collected totals and missing source
  lines atomically. This is a static finding, not a reproduced database failure.
- **Lifecycle acceptance still outstanding:** execute source/payment/redemption/
  refund/transfer races, rollback, tenant/role/PIN refusals, value-package refunds,
  legacy unavailable evidence, corrections and complete detail/refund/PIN UI tests
  only after their applicable authorization gates. The four focused web suites do
  not establish full `PackagePayrollDetail` or transactional acceptance.
- Checks rerun: shared tests **267/267**; focused web **25/25** across four files;
  workspace typechecks and lint **exit 0**. Logs:
  `/tmp/cp004-economic-review-{shared,web,types,lint}.log`.
  No API/database acceptance, full web regression, production build or browser run.
- CP-004 remains **IN PROGRESS**. Economic fixes need implementation authorization;
  all database work remains paused pending owner review/separate approval. CP-005
  is unstarted; CP-003A remains **TODO** after CP-005.

## October 28, 2026 — CP-004 PIN-budget isolation fix

- User authorized this fix and non-database tests only. Preserved the pre-existing
  tracking-document edits; no database commands or application activation.
- `apps/api/src/middleware/rateLimit.ts` skips the approval budget for validated
  checkout bodies without `unpaidSessionOverride`. Both existing routes retain
  their validation-before-limiter order. Failed approval-bearing checkout requests
  still count; successful requests are removed as before. This does not distinguish
  a valid PIN followed by a downstream checkout failure from an invalid PIN.
- Added `apps/api/src/middleware/rateLimit.test.ts`: real loopback HTTP requests to
  an isolated Express harness, with the real checkout schemas, tenant context and
  limiter. No app/auth/Prisma/database import. Six tests cover unrelated checkout
  failures, non-PIN checkout after exhaustion, shared create/complete budget,
  manager rotation, tenant/operator isolation, concurrent failures and successful
  request exclusion. These tests do not exercise actual checkout transactions.
- Verification: focused tests 6/6, API typecheck and lint exit 0. Logs:
  `/tmp/cp004-pin-{tests,types,lint}.log`. Per-process memory storage remains a
  limitation; distributed retry protection is not accepted by this increment.
- CP-004 stays IN PROGRESS; refunds, economic review and complete transactional/UI
  acceptance remain. Database work is paused; CP-003A is TODO, not completed.

## October 28, 2026 — CP-004 non-database review

- Reviewed package session gates, tenant-scoped manager lookup, source collection
  capture, refund economics and checkout PIN limiter wiring. Existing tenant scope
  includes User; manager lookup is not an unscoped cross-company query. This is
  static inspection, not transactional/security acceptance.
- Confirmed PIN-budget issue: `managerPinLimiter` is unconditional on both checkout
  routes and skips only successful responses. Non-PIN checkout failures consume
  the same budget and can block ordinary checkout. Isolate approval attempts and
  verify that unrelated failures do not consume the budget; add retry/race tests.
- Confirmed refund limitation: `refundPayrollPackage` rejects zero refundable net
  before unused-session cancellation and outstanding-balance reconciliation. Define
  and test zero-payout cancellation when used value/fees consume collected cash;
  do not infer a new payout policy from this finding.
- Quantity handling needs policy verification: holdings aggregate a sale line's
  quantity/session grant, but collection capture uses the configured fixed amount
  once without multiplying line quantity, while source units include line quantity.
  Determine the required fixed-award unit and cover multi-quantity purchase/refund.
- FOC capture uses `line.item.unitPrice` and mixed-credit allocation branches.
  Full-list-price versus member-price/net treatment and FOC on mixed receipts remain
  unaccepted; no economic correctness claim follows from passing arithmetic tests.
- Verification: shared build; shared tests 267/267; focused web 25/25 in
  CustomerSessionPackagesPanel, PackageFormDrawer, package-coverage and
  family-credit-payment; workspace typechecks and lint exit 0. Logs:
  `/tmp/cp004-review-{shared,web,types,lint}.log`. Focused web does not cover the
  complete new detail/refund/PIN UI. No DB access, full regression or browser run.
- Only tracking documents changed. No commits, pushes, deployment or activation.

## October 28, 2026 — CP-004 explicit package settings increment

- Added exact shared sale/redemption settings: explicit FOLLOW_PLAN, EXCLUDE or
  FIXED, required fixed amount when applicable, and explicit bounded minimum deposit.
  No default mode, award or deposit. Unknown legacy settings remain null.
- Added prospective migration `20261028100000_package_commission_settings` and
  nullable catalogue JSON. Existing holding evidence is never updated/backfilled.
- Package create/update validates settings server-side. Enabled, two-factor-verified
  salon owner required; reason and update token required. Before/after audit and
  settings share one transaction and existing prepaid/package row lock ordering.
- Editor exposes explicit settings only to owners, validates exact strings and
  forwards reason/update token. New completed purchases (including held completion)
  copy settings into immutable purchase snapshots; subsequent catalogue changes,
  transfers and collections preserve original evidence. Old snapshots remain valid.
- Expanded shared/UI and disposable POS acceptance: denied manager/cross-tenant
  writes, stale and concurrent writes, rejected-write rollback/audit consistency,
  original versus future settings, held completion, unchanged legacy null evidence
  and no added earnings.
- Verified: disposable PostgreSQL 18 loopback 55476, 60 migrations replayed;
  shared 265/265, focused API 68/68, collection/POS integration 1/1, focused web
  30/30; workspace typechecks/lint, shared build/client generation and diff check
  pass. Final runner exit 0; disposable database stopped. Logs:
  `/tmp/cp004-settings-0CyDvM/` (pointer `/tmp/cp004-settings-path`). Early iterations
  caught and fixed a malformed-input refinement throw, test signature/name errors
  and a stale missing-settings assertion. Full regression/build/browser not rerun.
- Still economics-only capture, not complete engine-ready inputs. Deposit settings
  are captured but not enforced; fixed/exclude posting, redemption ordinal integration,
  paid-session/PIN gates, remaining capture/refund/correction/race checks remain.
  CP-004 IN PROGRESS; CP-005 not started. No application DB writes, activation,
  production migration, deployment, commit or push.

## October 28, 2026 — CP-004 immutable purchase economics increment

- Resumed the active task without replacing prior collection work. Inspected SRS
  FR-BAS-04/05 and FR-POS-04–06, grant/redemption/transfer transactions, PIN identity
  service and operational valuation activation boundary. No external dependencies.
- Added shared `package-purchase.ts` and five tests. Purchase snapshots retain
  original contract net/GST/gross, session grant, sellers, purchaser, source/time/
  outlet/currency. Session range calculations use original ordinals with exact
  four-decimal quotient/remainder and deterministic performer splits. They do not
  reuse the cent-rounded operational valuation ledger or current catalogue prices.
- Added nullable `CustomerPackageHolding.payrollPurchaseSnapshot` and prospective
  migration `20261028093000_package_payroll_purchase_snapshot`. New POS purchases
  and held-sale completion capture within the existing holding/source transaction,
  independently of valuation activation. No backfill. Database guards reject
  rewriting/clearing snapshots, attaching inferred evidence to existing null rows,
  and changing captured source identifiers or original session grant. Ownership,
  remaining balance and permitted expiry updates remain possible.
- Extended disposable acceptance: original source/economics/sellers, immutable JSON
  and grant, rollback, legacy null refusal, held-sale versus completion capture,
  missing evidence, catalogue edits, ownership transfer and subsequent balance
  collection preserve the original snapshot; tenant isolation and no added earnings.
- Fresh disposable PostgreSQL 18 on loopback 55476, `commission_collection_test`:
  **59 migrations replayed**, shared **262/262**, focused API **68/68**, collection
  HTTP/POS integration **1/1**, focused web **23/23**, workspace typechecks/lint,
  shared build/client generation and whitespace checks pass. Final expanded
  collection suite **1/1**, API typecheck/lint rerun, exit 0; database stopped.
  Logs: `/tmp/cp004-purchase-Rmu5tg/`. Final formatting review recorded separately.
- Boundary: economics-only snapshots explicitly list missing package commission
  settings, plus currency/sellers where absent. No inferred mode, fixed award,
  fallback or earning. Session helper is not yet integrated with redemption; no
  accepted paid-session/PIN gate or complete FR-POS-06 settings snapshot. Existing
  unknown legacy evidence remains unchanged. CP-004 stays IN PROGRESS.
- Next: package commission settings, redemption integration and deposit/paid-session/
  PIN workflow. Other source capture, value-package ratio, refunds/void/corrections
  and broader concurrent lifecycle acceptance remain. CP-005 not started.
  No application DB access, production migration, activation, backfill, deployment,
  commit or push. Full regression/root production build/browser tests not rerun.

## October 28, 2026 — CP-004 package collection capture increment

- Marked CP-004 IN PROGRESS and corrected the stale root task pointer. Inspected
  adopted policy, existing source transactions, collection/redemption evidence,
  Prisma tenant scoping and shared four-decimal split utilities.
- Added shared `commission-payroll/collection.ts` and five tests. Source-linked
  PKG_SALE collection facts preserve original seller identity, collection occurrence,
  sale/line/payment/outlet and net/GST consideration. Stable staff-ID residual
  allocation reconciles four-decimal bases; no rate or earnings in the new object.
- `commission-collection-evidence.ts` stores the object within each PACKAGE
  allocation's immutable JSON using the existing source transaction/locks. No schema
  migration, new table, dependency or public endpoint. Unknown sale currency or
  sellers produces UNAVAILABLE/null bases, not inferred zeros/current staff.
  Older evidence is unchanged. The facts are deliberately not PayrollBaseLine:
  modes, units, fallback, full coverage and downstream lifecycle remain unaccepted.
- Extended disposable collection acceptance with missing-evidence, disabled original
  seller, concurrent/conflicting retries, original source lineage, tenant isolation,
  source-payment plus evidence rollback and unchanged earnings assertions. Real POS
  package purchase and concurrent balance collection reconcile all net bases and GST.
- Checks: PostgreSQL 18 loopback 55476, `commission_collection_test`, fresh replay
  of **58 migrations**; shared build/client generation; shared **257/257**; workspace
  typechecks/lint; collection service/HTTP/POS integration **1/1**; focused API
  collection/redemption/sale checks **68/68**; focused web **23/23**. Final expanded
  package acceptance **1/1**, API typecheck/lint rerun, exit 0. Cluster stopped.
  Logs: `/tmp/cp004-capture-hkCsZz/` (results, recheck-exit-code and individual logs).
- Full CP-004 completion checks remain unmet: service/product/FOC/category capture,
  package mode/fixed awards and commission-unit snapshots, deposit/paid-session/PIN,
  value-package ratio, refund/clawback/void/staff-correction lifecycle and required
  concurrent transfer/refund/redemption acceptance. Resume CP-004; do not start
  CP-005. Full regression/root production build/browser acceptance not rerun.
- No application DB access, production migration, backfill, earnings activation,
  deployment, commit or push. Historical monetary readiness remains unavailable.

## October 28, 2026 — CP-003 configuration-only acceptance complete

- Reviewed the approved scope against implementation and mapped completion checks
  in CONFIGURATION_ACCEPTANCE.md. No remaining configuration-only blocker found;
  CP-003 marked DONE. CP-003A retains historical monetary integration/equality and
  CP-007 release gating. Corrected FR-SET/TC-25 ownership in REQUIREMENTS.md.
- Fresh PostgreSQL 18 on loopback 55474, `payroll_configuration_test`: **58 migrations
  replayed**. Root production build, workspace typechecks and lint pass. Shared
  **252/252**; full serial API with CP-003 opt-in **638 passed, 35 unrelated gated
  skips, zero failures**; real Chrome/API **18/18 twice**; web **910/910 across 106
  files** with one worker. Runner exited 0; disposable cluster stopped cleanly.
- Service/HTTP/browser checks cover immutable publication/audit, tenant/outlet scope,
  reasoned owner writes, salary redaction, atomic staff creation/lifecycle rollback,
  concurrency and stale reload. Readiness remains UNAVAILABLE/null; earnings remain
  inactive and browser checks preserve earnings/collection counts. Sample calculator
  checks use the shared engine, not fabricated historical financial evidence.
- Logs: `/tmp/cp003-config-review-LobY2h/` (results, build, migrate, typecheck, lint,
  shared, api, browser, browser-repeat, web, stop and exit-code). Missing clipboard
  helpers and pg queued-query deprecations were non-failing warnings.
- No application source edits, application DB access/migration, historical backfill,
  earnings activation, dependency installation, deployment, commit or push. Existing
  changed application files hash-verified unchanged. Browser login/2FA/refresh,
  exhaustive interleavings and production readiness remain outside this acceptance.
- Next ready task: CP-004. Stop after this acceptance; do not start it automatically.

## October 28, 2026 — Approved configuration/historical-preview scope split

- User approved Option 2, conditional on configuration safety without historical
  monetary preview. Updated PROJECT, DECISIONS, TASKS, REQUIREMENTS, evidence/browser
  boundaries and root handoff. CP-003 is IN PROGRESS rather than BLOCKED or DONE.
- Added CP-003A for authoritative historical monetary integration and full-run
  equality after CP-004/CP-005; CP-007 explicitly depends on it. No must-have was
  removed. Chronological checkpoints below retain their original status claims.
- Inspected service boundary: readiness returns explicit missing-evidence blockers
  and `impact: null`; configuration reports `earningsActive: false`. Focused
  input/timezone tests **22/22 passed**; five web configuration/readiness files
  **45/45 passed**, including unavailable preview, permission loss, stale revisions,
  reasoned edits, salary redaction, scoped assignment and shared sample calculator.
- These focused checks support the safe separation, not fresh full DB/browser
  acceptance. Prior disposable API/browser results remain historical evidence.
  Prettier reports all eight edited documents formatted; local Markdown links
  resolve and all eight task dependency nodes are acyclic, with CP-003A retained
  as a release gate. `git diff --check` emitted no errors. The terminal wrapper
  did not confirm command completion despite displaying the final PASS output.
- No application code edits, database operations, earnings activation, CP-004
  implementation, dependency installation, deployment, commit or push. Existing
  uncommitted application changes preserved. Next: consolidate CP-003 configuration
  acceptance and rerun remaining needed disposable integration checks before DONE.

## October 28, 2026 — CP-003 blocker confirmed on resumption

- Re-read the historical evidence contract, readiness resolver/service and collection/
  earnings schema. Collections do not establish complete rate-free payroll inputs;
  rate-bearing earnings cannot substitute for them. The service deliberately returns
  the three missing monetary evidence blockers and `impact: null`.
- Focused historical-input tests: **7/7 passed**. This is current validation of the
  resolver only; prior full regression/browser results below were not rerun.
- Marked CP-003 BLOCKED rather than leave an unexecutable monetary integration step
  IN PROGRESS. Needed decision: identify a concrete authorized evidence source, or
  approve a scope/dependency revision. No speculative storage/adapter, CP-004 work,
  application DB access, migration, activation, deployment or commit performed.

## October 27, 2026 — CP-003 remaining named browser gaps and completion review

- Continued CP-003 only. Added Chrome salary reason/exact-decimal audit checks,
  manager salary profile/history redaction and direct write denial. Concurrent
  profile/settings updates retain local edits and require explicit reload; the
  stale forms cannot save. Staff creation refuses missing plan without identity,
  then atomically persists classified staff, join date, department link and a
  published outlet-scoped assignment. Final audit counts and unchanged earnings/
  collections verified. No production changes required for this increment.
- Browser **18/18 on two runs** (17 children plus parent). Full serial API:
  **638 passed, 35 gated skips, zero failures**, including configuration and
  lifecycle concurrency acceptance. Shared **252/252**. Full web initially had
  10 failures in PayrollPlans under concurrent CPU load (nine timeouts followed by
  an extra-alert failure); unchanged rerun with `--maxWorkers=1` passed **910/910,
  106 files**, exit 0. No test assertions weakened or timeout settings changed.
  Clipboard helper warnings (`xclip`/`xsel` absent) were non-failing.
- API typecheck/lint/build and browser formatting/whitespace checks pass. Default
  browser opt-out skips one, exit 0, with required environment supplied; a bare
  invocation without DATABASE_URL fails module initialization as expected.
- Logs: `/tmp/cp003-browser-final-gaps{,-repeat}.log`,
  `/tmp/cp003-completion-{api,web,web-serial,shared}.log`. Only synthetic disposable
  data written; immutable evidence retained. PostgreSQL at
  `/tmp/cp003-edit-guard-pg-gzy72041`, port 55474, stopped after API checks.
- Completion review: named browser gaps above are covered, not every invalid
  definition/lifecycle/interleaving. CP-003 remains **IN PROGRESS** because its
  historical impact/calculator/full-run equality completion check is blocked by
  missing authoritative complete rate-free monetary inputs, frozen opening carry
  and scoped group metrics. See HISTORICAL_INPUTS.md. Fail-closed `UNAVAILABLE`,
  `impact: null` remains correct. No invented zeros, legacy-earnings inference,
  current-price substitution, application DB writes, migration, activation,
  deployment or commit. CP-004 remains TODO. Next: establish authoritative evidence
  and its integration before implementing or accepting monetary preview equality.

## October 27, 2026 — CP-003 browser assignment and salon settings acceptance

- Added four real Chrome/API/DB cases to the existing suite. Commission-role save
  without coverage refuses without identity/audit changes and retains local edits.
  Owner then saves non-commission/join date, assigns the published company plan,
  and saves commission classification. Checks ongoing snapshotted assignment scope,
  join date and audit revisions/counts/actor/reason. Explicit reload adopts saves.
- Salon settings network failure retains exact decimal local values without audit;
  retry persists the expected reasoned payload. Manager assignment/classification/
  salon controls are disabled; direct writes return 403 without evidence changes.
  Final earnings/collection counts remain unchanged. No production changes needed.
- Expanded browser **15/15 on two runs**, latest exit 0; default gate one skipped,
  exit 0. Focused web **29/29**, input/timezone **22/22**, API typecheck/lint/build
  pass. Formatting/whitespace checks pass. Full API/web/shared regressions not rerun.
- Initial assignment fixture lacked an audited join date because the deliberately
  refused classification correctly did not save it. Fixed setup through the real
  UI's valid non-commission classification path before assignment, not DB bypass.
- Prior changes preserved. Only synthetic disposable writes on port 55474;
  `/tmp/cp003-edit-guard-pg-gzy72041` stopped after checks. Immutable audit retained;
  no trigger changes/deletion, application DB writes, activation, migrations,
  dependencies, deployment, commit or push. Logs `/tmp/cp003-browser-settings{,-repeat}.log`.
- CP-003 IN PROGRESS. Next unblocked browser gaps: staff creation, salary profiles,
  outlet-scoped assignment and stale settings conflict handling. Historical monetary
  integration/full-run equality remain blocked on authoritative inputs. CP-004 untouched.

## October 27, 2026 — CP-003 browser plan lifecycle acceptance

- Extended the existing opt-in Chrome suite with four real UI/API/DB cases:
  missing-reason creation leaves no plan/audit; reasoned Hair sample creation
  persists the exact shared definition; unsaved edits block publication, saved
  draft publishes and a future version leaves the published snapshot unchanged;
  duplicate/archive preserves source history; manager controls/direct publish
  refuse writes. Persisted revision, version, actor/reason and audit counts checked.
- No production changes required. Existing readiness checks remain, including
  no preview writes. Final lifecycle phase also checks unchanged earnings and
  collection counts. This does not cover all staff/settings/assignment browser flows.
- Expanded suite **11/11 on two runs**, latest exit 0; default gate one skipped
  test, exit 0. Focused web **29/29**, input/timezone **22/22**, API
  typecheck/lint/build and formatting/whitespace checks pass. Full regression
  suites not rerun; earlier full-suite totals remain historical evidence.
- Initial runs exposed harness-only CORS-origin, DOM-result serialization and
  native date-input issues. Explicit test-origin prerequisite, boolean waits and
  native DOM date/select events fix those without bypassing API authorization.
  Updated BROWSER_ACCEPTANCE.md with setup and coverage limits.
- Prior working-tree changes preserved. Synthetic writes only in disposable
  `/tmp/cp003-edit-guard-pg-gzy72041`, port 55474; cluster stopped after validation.
  Synthetic immutable evidence retained, no audit deletion/trigger bypass.
  Logs `/tmp/cp003-browser-lifecycle{,-repeat}.log`. No application DB writes,
  activation, dependencies, migration, deployment, commit or push.
- CP-003 remains IN PROGRESS. Next unblocked work: staff classification/assignment
  and salary/settings browser acceptance. Complete historical monetary integration
  and full-run equality still blocked on authoritative evidence. CP-004 untouched.

## October 27, 2026 — CP-003 authenticated readiness browser acceptance

- Added opt-in `payroll-preview-browser.acceptance.test.ts`, using installed
  headless Chrome debugging pipe, real Vite app/API and the existing disposable
  PostgreSQL on port 55474. No dependencies, response mocks or demo auth headers.
  Synthetic signed access-token bootstrap calls real `/auth/me`; login/2FA/refresh
  flows are deliberately not claimed. Instructions/limits: BROWSER_ACCEPTANCE.md.
- Six subtests cover owner/company unavailable evidence; failed retry clearing
  prior results and recovery; real stale metadata revision and reload/new check;
  server role demotion clearing evidence on retry; manager UI/direct API denial;
  outlet-owner UI/direct API denial. Parent checks no preview earnings/collection/
  audit writes, apart from the intentional metadata edit's one audit event.
- Final suite **7/7 on two runs**, final exit 0. Default opt-out verified: one
  skipped test, exit 0. Focused web **29/29**, input/timezone **22/22**, API
  typecheck/lint/build pass. Full API/web/shared regressions not rerun.
- Initial harness attempts failed (incorrect root resolution/native Node abort,
  then cleanup foreign-key refusal). Fixed path, awaited process shutdown and
  retained immutable synthetic evidence consistent with existing acceptance tests.
  No triggers disabled or audit rows deleted. Chrome sandbox remains enabled.
- Prior working-tree changes preserved. Only disposable DB synthetic fixtures/
  metadata/role changes were written; no application DB writes, migrations,
  activation, deployment, dependency additions, commit or push. Disposable cluster
  `/tmp/cp003-edit-guard-pg-gzy72041` stopped after checks. Logs:
  `/tmp/cp003-browser-{acceptance,repeat,final}.log`.
- CP-003 remains IN PROGRESS. Complete calculation/equality blocked on authoritative
  evidence; broader configuration-browser acceptance and other interleavings remain
  unclaimed. Permission loss is observed on the next request, not pushed to idle
  pages. CP-004 untouched.

## October 27, 2026 — CP-003 historical evidence contract

- Inspected persisted collection/legacy earnings fields and shared period-engine
  inputs. No complete authoritative historical monetary source was established.
  `HISTORICAL_INPUTS.md` records the integration gate: complete reconciled source
  coverage, source-time rate-free lines, frozen opening balances, scoped group
  metrics and configuration/source revision identity. This is a contract for
  future integration, not an implemented monetary adapter or permission for CP-004.
- Invalid latest pre-close salon settings now preserve their audit ID/revision
  and return HISTORICAL_SALON_SETTINGS_UNAVAILABLE instead of throwing. Added
  salon/staff invalid-latest regression cases proving no fallback to older valid
  or post-close/current settings. Status/impact remain UNAVAILABLE/null.
- Verified focused input/timezone **22/22**, API typecheck, lint and build
  (including shared build). Initial test-fixture type inference error was fixed
  before successful validation. Full API/web/shared regressions and authenticated
  browser acceptance were not rerun. Previous regression totals are historical.
- Initial working tree was clean; earlier accumulated work was already present
  in repository files. No database startup/writes, migrations, activation,
  dependencies, deployment, commit or push. CP-003 remains IN PROGRESS; complete
  calculation/equality remain blocked on authoritative evidence; CP-004 untouched.

## October 27, 2026 — CP-003 lifecycle concurrency acceptance

- Added isolated opt-in disposable-database tests using existing tenant configuration
  locks and service entry points. Five competing-write cases verify persisted state,
  domain-level refusals (not DB failures), exact audit increments and rollback:
  competing classified creation with the same assignment revision; join-date edit
  versus earlier assignment; commission classification versus scheduled plan removal;
  audited join-date repair versus reactivation; same-revision stage-setting edits.
- Losing creation leaves no identity or department links. Incompatible assignment/
  join-date changes cannot both commit; commission earners retain an ongoing plan.
  Reactivation either follows committed repair or refuses without partial identity/
  department writes, then succeeds on retry. Competing settings keep one audited
  winner. Tests do not require a particular transaction scheduling order.
- Initial combined lifecycle/HTTP suite passed 6/6 before the reactivation case was
  added. Final concurrency suite passed **6/6 on each of three repeated runs**
  (five subtests plus parent). API typecheck, lint and production build pass.
  Final serial disposable API regression: **636 passed, 34 gated skips, zero
  failures** (670 tests), exit 0; includes existing lifecycle/HTTP and new races.
- Test-only increment: no production behavior, schema, POS/base capture or earnings
  changes. This is concurrent-submission coverage, not deterministic proof of every
  database interleaving, browser acceptance or complete lifecycle acceptance.
- Remaining: authoritative historical monetary inputs/full-run equality and
  authenticated browser acceptance. CP-003 remains IN PROGRESS; CP-004 untouched.
  Full web/shared regressions not rerun; previous UI evidence remains historical.
  Disposable cluster reused only; no application DB writes, reset, audit deletion,
  dependency, migration, activation, deployment, commit or push.
- Disposable PostgreSQL `/tmp/cp003-edit-guard-pg-gzy72041`, port 55474, stopped
  after verification; logs `/tmp/cp003-lifecycle-races-*.log`.

## October 27, 2026 — CP-003 historical readiness UI

- Connected the existing readiness endpoint to company-owner plan settings through
  an on-demand panel. Managers, outlet sessions and staff-specific payroll panels
  do not expose it. Server authorization remains mandatory.
- The panel displays server-owned month/timezone and half-open UTC boundaries,
  assignment/settings audit revisions, published staff versions and missing staff
  settings. Currently disabled staff remain visible. Record counts are explicitly
  salon-wide inventory, not complete bases, payable amounts or plan-specific totals.
- Runtime response validation accepts only UNAVAILABLE/null-impact/inactive-earnings
  responses matching the selected plan/revision. Keyed request state prevents late
  responses from leaking across plan/revision changes; refresh/save, request failures
  and permission/context changes hide results. Retry remains available after refusal.
- Missing monetary inputs remain unresolved; no fake zero, partial payout estimate,
  current catalogue substitution or unsaved-rule impact claim. Complete historical
  monetary integration/full-run equality, lifecycle concurrency and authenticated
  browser acceptance remain open. CP-003 stays IN PROGRESS; CP-004 untouched.
- Full web **910/910 across 106 files**, one worker, exit 0, including new readiness
  and permission-revocation checks; focused historical-input/timezone **20/20**.
  Web typecheck/lint/production build, changed-file formatting and whitespace pass.
  Browser acceptance and full API/shared regressions not run; API/database code
  unchanged in this continuation. No application DB writes, new dependencies,
  migrations, activation, deployment, commit or push.

## October 27, 2026 — CP-003 historical input readiness

- Added owner-only company-context GET `/api/payroll-configuration/plans/:id/historical-preview`
  with required expectedRevision. Strict query validation excludes client bases,
  staff lists and group metrics. Repeatable-read transaction keeps configuration
  and evidence counts coherent without writing application records.
- Server-owned timezone determines the last completed calendar month and half-open
  boundaries. Full assignment replacement history resolves month-end membership;
  published effective versions exclude drafts/future versions. Disabled staff remain
  eligible. Historical staff/salon settings require pre-close audit, never current
  identity values or invented default settings. IDs/revisions identify selected evidence.
- This is readiness inventory, NOT a working impact calculation: response always
  reports UNAVAILABLE with null impact and explicit missing rate-free base, frozen
  carry and group-metric blockers. Collection/legacy-earnings counts are inventory
  only, not complete base coverage or payable amounts. No new evidence capture,
  database migration, POS integration, earnings activation or historical rewrite.
- Verification: focused preview/wall-clock tests 20/20; API typecheck, lint and
  production build pass. Final disposable lifecycle acceptance 1/1 passes, including
  authenticated preview success, owner-only access, strict query refusal, stale
  revisions, service outlet refusal and no audit writes. Initial fixture lacked required assignment ID
  and was corrected; initial acceptance lacked synthetic JWT environment and reran.
- Remaining: complete historical monetary inputs/full-run equality, UI integration,
  lifecycle concurrency and authenticated browser acceptance. CP-003 IN PROGRESS;
  CP-004 untouched. Existing evidence schema cannot substantiate complete historical
  bases/categories/outlets/fixed awards or frozen carry; do not infer them from
  present catalogue prices or legacy rate-bearing earnings.
- Disposable cluster `/tmp/cp003-edit-guard-pg-gzy72041`, port 55474, stopped after
  verification. Logs `/tmp/cp003-preview-*.log`. Full API/shared/web regressions and
  browser acceptance not rerun. No application database writes, deployment or commit.

## October 27, 2026 — CP-003 outlet assignment checkpoint

- One staff timeline retained. New assignment rows snapshot validated plan outlets;
  legacy rows remain company-wide. Company owners can assign scoped plans during
  creation or bulk changes. Outlet sessions cannot manage staff timelines/profiles.
  Immutable plan scope, stale revision checks and audit rollback remain enforced.
- Plan selection/history explain selected/all outlets. Pure partitioning pools
  eligible outlets together once, separates fallback activity, rejects duplicate
  pools and missing outlet evidence, and guards against unpartitioned calculation.
- Added scoped initial creation/edit, multi-outlet replacement/history, inactive
  outlet rollback, cross-tenant assignment refusal and immutable-scope assertions.
  Shared tests cover pooled tiers, fallback source rates, fixed awards, refund
  carry, unknown outlets and client scope spoofing; UI checks cover selection.
- This is not complete payroll orchestration. Historical preview, browser acceptance
  and lifecycle concurrency remain open; scoped statement/carry/incentive integration
  belongs to CP-005. CP-003 stays IN PROGRESS; CP-004 untouched.
- Verified: shared **252/252**; focused plan/initial-picker UI **23/23**; full web
  **901/901** across 105 files, one worker. Serial disposable API **625 passed,
  34 gated skips, zero failures**, exit 0. Latest focused lifecycle/staff HTTP
  **25/25** includes cross-tenant scoped-plan/staff refusal added after full-run
  startup. API/web typechecks, root build/lint, formatting and whitespace pass.
  Browser acceptance and parallel API regression not run; prior timeout limitation
  remains. Full web logs contain non-fatal missing xclip/xsel clipboard warnings.
- Reused only disposable PostgreSQL cluster `/tmp/cp003-edit-guard-pg-gzy72041`,
  database `payroll_configuration_test`, port 55474; stopped and port confirmed
  inactive. Logs: `/tmp/cp003-outlet-*.log`. No application DB writes, dependencies,
  migrations, historical rewrite, activation, deployment, commit or push.

## October 27, 2026 — CP-003 mandatory classified staff creation

- Shared create schema requires explicit reasoned classification and join date.
  Direct service calls validate the same schema and reject missing classification;
  the payroll transaction helper rejects it too. All creation uses the existing
  owner-verified writable-tenant transaction. Commission earners require initial
  current-month/ongoing plan coverage; failed creation rolls back identity/links/audit.
- Staff POST is now owner-only, preserving classification privileges. Managers
  retain valid profile edits and suspension, but no unclassified creation path.
  UI hides manager creation, explains owner setup and requires explicit selection;
  post-create continuation is only for additional settings, not deferred classification.
- Updated shared password-policy fixtures without weakening credential assertions.
  Added identity-only refusal across login roles, owner HTTP refusal/no-write and
  manager HTTP refusal; existing creation, stale-revision, rollback, PIN-reset,
  permissions and tenant-isolation assertions pass with explicit classified fixtures.
- Verified: shared **248/248**; focused staff/plan UI **24/24**; full web **900/900**,
  105 files, one worker. Focused disposable lifecycle/staff HTTP **25/25**; complete
  serial API with CP-003 enabled **625 passed, 34 gated skips, zero failures**, exit 0,
  about 305 seconds. API/web typechecks, root build, root lint, changed-file formatting
  and whitespace checks pass. Authenticated browser acceptance and parallel API
  regression not run; earlier parallel timeout limitation remains.
- Reused disposable PostgreSQL 18 cluster `/tmp/cp003-edit-guard-pg-gzy72041`,
  localhost:55474, database `payroll_configuration_test` only. Logs:
  `/tmp/cp003-create-*.log`. No application database writes, schema changes,
  dependencies, historical rewrite, earnings activation, deployment, commit or push.
  Disposable cluster stopped after verification; localhost:55474 confirmed inactive.
- CP-003 remains IN PROGRESS. Next: outlet assignment/pooling, authoritative
  historical preview inputs, remaining lifecycle concurrency and authenticated
  browser acceptance. CP-004 was not started.

## October 27, 2026 — CP-003 unclassified active-edit enforcement

- Removed the unclassified active-edit exemption. Missing/unknown classification
  now rejects active staff edits/reactivation under the tenant configuration lock,
  before identity or branch-link writes. Role/title changes do not bypass setup.
  Suspension and disabled maintenance remain available; owner-only reasoned
  classification/date setup restores manager edits/reactivation.
- Added service assertions for owner/manager rejection, rollback of identity,
  branch links and audit count, disabled maintenance, manager repair refusal and
  successful recovery. HTTP PIN reset verifies rejection before explicit synthetic
  setup, then existing reset/session-revocation behavior. Profile fixtures explicitly
  classify staff; uniquely named synthetic tenants retain immutable audit evidence.
- Focused disposable lifecycle/staff HTTP **23/23**. API typecheck, lint and build
  (including shared prebuild) pass. Full serial API with CP-003 enabled:
  **623 passed, 34 separately gated skips, zero failures**, exit 0, about 309 s.
  Web/shared tests and authenticated browser acceptance not run for this API-only
  increment. No claim of parallel API reliability.
- Reused stopped disposable PostgreSQL 18 cluster
  `/tmp/cp003-edit-guard-pg-gzy72041`, localhost:55474,
  database `payroll_configuration_test`. Logs: `/tmp/cp003-unclassified-*.log`.
  Cluster stopped after verification and localhost:55474 confirmed inactive.
  No application database writes, dependencies, migration changes, earnings
  activation, deployment, commit or push. Existing working changes preserved.
- CP-003 remains IN PROGRESS: mandatory creation, outlet pooling, authoritative
  historical inputs and authenticated browser acceptance remain open. CP-004 not started.

## October 27, 2026 — CP-003 classified staff edit/reactivation guard

- General staff PATCH now checks latest audited classification within its tenant
  configuration lock. Active classified staff require a join date; commission
  earners require current-month and ongoing plan coverage. Payroll settings and
  staff updates reuse the same coverage validator. No schema/UI/dependency changes.
- Rejections happen before identity/department writes. Disabling remains possible
  for inconsistent records; reactivation fails until the owner repairs payroll
  settings. Unclassified legacy staff remain a deliberate, incomplete compatibility
  path rather than being silently labeled non-commission.
- Disposable lifecycle assertions cover valid classified profile edit, invalid
  edit rollback of name/department/audit, disable/reactivation checks, owner repair,
  manager reactivation after repair and classified non-commission missing-date
  recovery. Synthetic inconsistent imported evidence is test-only.
- Focused disposable lifecycle/staff HTTP **23/23**, API typecheck and lint pass.
  Full serial API with CP-003 enabled **623 passed, 34 gated skips, zero failures**,
  exit 0, approximately 336 seconds. API production build (including shared
  prebuild), changed-file formatting and whitespace checks pass. Web/shared tests
  not rerun for this API-only increment. Authenticated browser acceptance and
  parallel API regression not run; prior parallel timeout limitation remains.
- Fresh PostgreSQL 18 cluster `/tmp/cp003-edit-guard-pg-gzy72041`, localhost:55474,
  database `payroll_configuration_test`; existing migrations replayed only there.
  Disposable cluster stopped after verification and port confirmed inactive.
  Logs: `/tmp/cp003-edit-guard-*.log`. Prior scratch-cluster path was no longer
  present, so no application database was reused. No earnings activation,
  deployment, dependencies, commit or push; prior working changes preserved.
- CP-003 stays IN PROGRESS. Mandatory unclassified create/edit lifecycle integration,
  outlet assignment/pooling, authoritative historical inputs and authenticated
  browser acceptance remain open. CP-004 was not started.

## October 27, 2026 — CP-003 atomic classified creation

- Added optional reasoned `payrollClassification` to shared staff creation contract
  and owner-only creation drawer. Join date required for classified creation;
  commission-earning choice requires an initial plan and enables its picker.
  Non-commission classified creation does not require a plan.
- Reused payroll STAFF validation within the existing owner-verified locked
  transaction. Identity, department links, assignment and classification audit
  commit atomically. Refactored existing settings write to share its transaction
  helper without nesting transactions. No schema changes or dependencies.
- Disposable cases cover missing plan, future-only assignment rollback of identity/
  links/audit, successful classified creation and non-commission creation, plus
  manager denial. UI test verifies one request carries dated classification and
  initial assignment; shared contracts verify join-date/plan/reason requirements.
- Focused checks: shared **247/247**, staff UI **22/22**, disposable lifecycle and
  staff HTTP **23/23**. Final full web **898/898** (105 files, one worker); full serial
  API with CP-003 enabled **623 passed, 34 gated skips, zero failures**, exit 0,
  approximately 265 seconds. Root build, workspace typechecks, lint, changed-file
  formatting and whitespace checks pass. Parallel API was not repeated; previous
  transaction-timeout limitation remains. Authenticated browser acceptance not run.
- Logs: `/tmp/cp003-classified-create-*.log`; only existing disposable cluster at
  localhost:55474 / `payroll_configuration_test` used. Disposable cluster stopped
  after verification; port confirmed inactive. No application DB writes,
  earnings activation, dependencies, deployment, commit or push. Earlier working
  changes preserved.
- CP-003 remains IN PROGRESS: mandatory create/edit lifecycle enforcement,
  outlet assignment/pooling, authoritative historical inputs and authenticated
  browser acceptance remain open. CP-004 was not started.

## October 27, 2026 — CP-003 explicit commission classification

- Added optional explicit `commissionRole` to reasoned payroll STAFF settings.
  Existing unclassified staff read as null, visibly requiring review. Login roles,
  job titles and legacy rates do not determine classification. Older callers omit
  the field without clearing an existing audited classification; invalid/null
  writes fail schema validation. No schema migration or dependencies added.
- Owner classification as commission earning requires authoritative join date,
  current-month-end plan coverage and an open-ended assignment. Plan removal is
  rejected until explicit reasoned reclassification. All writes share existing
  tenant configuration lock, owner checks and optimistic revisions.
- Structured staff payroll form exposes classification, captures it with the
  revision, preserves local edits on refresh and requires explicit reload. Added
  shared contract, UI stale/submission and disposable lifecycle rollback/stale/
  omission/plan-removal/scheduled-removal assertions.
- Verified: shared **246/246**, focused payroll UI **30/30**, disposable lifecycle
  acceptance **1/1**. Full web **897/897**, 105 files, one worker; complete serial
  API suite with CP-003 enabled **623 passed, 34 separately gated skips, zero
  failures**, approximately 314 seconds, exit 0. Root build, workspace typechecks,
  lint, changed-file formatting and whitespace checks pass. Parallel API regression
  was not repeated; preceding timeout reliability limitation remains recorded.
- Reused only the stopped disposable PostgreSQL cluster from the preceding
  continuation at localhost:55474, database `payroll_configuration_test`.
  Cluster stopped after checks and port verified inactive.
  Logs: `/tmp/cp003-role-*.log`. No application DB, earnings activation, deployment,
  commit or push. Existing uncommitted work preserved.
- CP-003 remains IN PROGRESS. Mandatory staff create/edit classification/plan/date
  enforcement, outlet pooling, authoritative historical inputs and authenticated
  browser acceptance remain open. CP-004 was not started.

## October 27, 2026 — CP-003 assignment/join-date consistency

- Resumed the existing dirty working tree without discarding the prior atomic
  staff creation continuation. CP-004 remains untouched.
- Assignment creation/replacement now rejects dates before `User.startDate`.
  Owner payroll date edits reject join dates after any existing assignment start.
  Both validations run inside the shared tenant configuration lock before audit
  writes; rejected edits preserve dates, assignment revisions and audit history.
- Disposable CP-003 lifecycle acceptance passes with additional rejection/rollback
  assertions in both directions. API typecheck and lint exit 0; source formatting
  and whitespace checks pass. Default API regression: 657 tests, 622 passed,
  35 skipped, zero failures. Skipped tests are separately gated acceptance suites.
- Final-source regression with CP-003 enabled: parallel run had 621 passed,
  two failures and 34 skipped. Existing resource-series and sale-tip/void tests
  exceeded database transaction timeouts under concurrency. No timeouts or tests
  were weakened. The same complete suite with `--test-concurrency=1` passed:
  **623 passed, 34 skipped, zero failures**, exit 0, approximately 253 seconds.
  CP-003 acceptance passes in both final runs. Parallel reliability remains a
  verification limitation, not a clean regression claim.
- Fresh PostgreSQL 18 cluster: `/tmp/cp003-lifecycle-pg-rhgzdce6`, localhost:55474,
  database `payroll_configuration_test`; existing migrations replayed only there.
  Cluster stopped after verification; localhost:55474 checked inactive.
  Check logs use `/tmp/cp003-lifecycle-`. No application database writes, schema
  changes, dependencies, earnings activation, deployment, commit or push.
- CP-003 stays IN PROGRESS. Mandatory lifecycle enforcement, explicit commission
  role classification, outlet assignment/pooling semantics, authoritative historical
  impact inputs and authenticated browser acceptance remain open. This bounded
  safety fix does not claim FR-ASN-01 acceptance or CP-004 progress.

## October 27, 2026 — CP-003 atomic staff/initial-plan continuation

- Resumed CP-003 from a clean working tree. Added optional `payrollAssignment`
  to staff creation and an owner-only company-context plan picker in the drawer.
  Shared schema requires join date, non-null plan, date, reason and captured
  assignment revision for this path. Existing identity-only creation remains.
- Identity, department links and assignment evidence now commit together. Reused
  assignment validation in the same owner-verified, writable-tenant configuration
  transaction; password/PIN hashing happens before acquiring the tenant lock.
  Ordinary identity creation also commits branch links atomically. Plan publication,
  company scope, prospective/locked-period and stale-revision guards remain intact.
- Failed creation retains form state; explicit plan reload resets the selection
  instead of silently rebasing a stale write. Existing post-create continuation
  remains available for payroll settings. No mirrored staff records or schema changes.
- Remaining: FR-ASN-01 mandatory plan/join-date enforcement across create/edit,
  commission-role classification, outlet assignment/pooling contract, authoritative
  historical inputs and authenticated browser acceptance. Optional atomic creation
  is not full lifecycle acceptance. CP-003 stays IN PROGRESS; do not start CP-004.
- Verified: shared **245/245**, staff UI **18/18**, plan-picker UI **3/3**;
  disposable payroll lifecycle acceptance and staff HTTP **22/22** pass. Acceptance
  covers missing-plan/manager/stale-revision rollback of staff, department links
  and audit, plus successful identity/date/link/assignment persistence. Workspace
  typechecks, root build, lint, changed-file Prettier and whitespace checks pass.
  Full web regression **896/896** (105 files, one worker) passes.
- Used a fresh PostgreSQL 18 cluster `/tmp/cp003-create-pg-*`, localhost:55474,
  replaying existing migrations only; cluster stopped and port checked inactive.
  Logs use `/tmp/cp003-create-` with acceptance, staff-api, shared, web-focused,
  picker, web-full, types, build, lint and format `.log` suffixes. Full API regression
  and authenticated browser walkthrough not run. No application database writes,
  schema changes, earnings activation, dependencies, deployment, commit or push.

## October 27, 2026 — CP-003 employment-date concurrency continuation

- Resumed CP-003; inspection reconfirmed outlet assignments cannot safely be enabled
  by removing the company-plan guard. Current assignment/period contracts select one
  staff plan and do not define concurrent outlet-specific pooling/selection. No
  inferred staff home outlet, multi-plan calculation or earnings behavior was added.
- Closed the independently actionable date race: payroll writes require captured
  `expectedJoinDate` plus payroll revision; staff date writes require captured
  `expectedStartDate`. Both compare inside transactions under the existing tenant
  configuration lock. Stale writes fail with conflict, including when another API
  changed the User date without changing its payroll revision. Comparison fields
  never reach persisted profile/audit payloads.
- Staff with payroll settings or assignment history must change dates through
  owner-only payroll settings with a reason. Identity-only changes remain available;
  unchanged start dates are still omitted by the drawer. Staff update and department
  replacement now share a transaction; PIN hashing occurs before lock acquisition.
  Existing PIN/commission/role/tenant checks remain. No schema or migration added.
- Web sends snapshot dates, including null for initially unset dates and refreshed
  expectations only after explicit reload. Help explains the payroll date workflow.
  API compatibility: old date-changing clients must reload/send comparison fields;
  unchanged-date/profile-only requests need no new field. See DECISIONS.md.
- Verification: full web **892/892** (104 files, one worker); shared **244/244**;
  focused web **46/46**; disposable CP service/HTTP acceptance and staff route
  regression **22/22** pass. Fresh PostgreSQL 18 at localhost:55474 replayed existing
  migrations only. Acceptance covers stale date rejection before first payroll event,
  no partial writes/audits, concurrent staff/payroll writers with exactly one winner,
  audited-workflow bypass refusal, unrelated profile edits, HTTP 422/409/400 and
  existing salary/outlet isolation. Root build, workspace typechecks and lint pass.
  Logs: `/tmp/cp003-date-{acceptance,staff-api,shared-tests,web-focused,web-full,build,types,lint}.log`.
- Remaining CP-003: outlet assignment contract/integration, required-plan/join-date
  staff create/edit enforcement, authoritative historical input integration and
  authenticated browser acceptance. Historical preview remains unavailable; no
  legacy payable totals used. Full API regression and browser walkthrough not run.
  No application database operations, activation, dependencies, deployment, commit
  or push. CP-003 remains IN PROGRESS; do not automatically start CP-004.

## October 27, 2026 — CP-003 metadata, staff workflow, comparison and audit continuation

- Added shared-schema-validated metadata editing with captured revision, retained
  failed edits and explicit reload. Published definitions remain unchanged. Outlet
  scope is read-only because the existing service requires duplication to change it.
  Metadata saves are disabled while rule edits/imports are unsaved.
- Staff creation optionally keeps the drawer open on the persisted identity for
  separate payroll setup. Subsequent identity saves update rather than create again.
  Edit drawers show selected-staff assignments, join date/stage and salary forms;
  managers remain read-only with salary omitted by the API. Company context is
  still required. Payroll and identity saves are explicitly separate transactions.
- Identity writes invalidate payroll data; payroll writes invalidate staff data.
  Unchanged identity-form join dates are omitted to avoid overwriting a date saved
  through payroll. Settings forms detect changed server values even when their
  payroll event revision is unchanged. Explicit concurrent date edits through the
  legacy staff endpoint still need stronger server-side concurrency enforcement.
- Version comparison selects any two saved definitions or an unsaved draft, matching
  components/stages/incentives by stable keys and displaying exact before/after
  values. Ordered bands/award rows compare as arrays. This is rule comparison, not
  monetary historical impact. Existing complete JSON history remains available.
- Audit supports validated 100-event pages and role/outlet-filtered totals using
  matching predicates. Stable timestamp/ID ordering prevents ties; concurrent new
  activity can shift offset-page boundaries (disclosed in UI). Paging retains local
  form state. Large-history cursor/performance acceptance is not claimed.
- Disposable PostgreSQL 18 migration replay and extended service/HTTP acceptance
  pass: metadata conflicts/immutable rules, >100 audit events without overlap,
  invalid pages, manager salary redaction and outlet-filtered totals. Only a fresh
  `/tmp/cp003-cont-pg-*` database at localhost:55474 was used and stopped afterward.
  Root build, workspace typechecks and lint pass. Verification logs:
  `/tmp/cp003-cont-{acceptance,build-final,types-final,lint-last}.log`;
  final web checks are recorded below. Several full web attempts timed out in the
  large editor. Memoized exact calculator/61-point curve generation so unrelated
  edits do not recompute charts; latest web build/typecheck/lint pass. Split one
  existing combined join-date/salon integration test into two focused tests,
  preserving all assertions and the default timeout. No checks disabled.
- Final full web run: **891/891**, 104 files, `--maxWorkers=1`, zero failures;
  `/tmp/cp003-cont-web-verified.log`. Includes 19 plan, 10 form, two comparison and
  16 staff tests. Final changed-source/document formatting and whitespace checks
  pass. Authenticated browser walkthrough and full API regression were not run.
- Remaining CP-003 work: outlet-scoped assignment contract and integration; required
  staff-plan/join-date enforcement; authoritative last-closed-month impact preview;
  remaining concurrency and authenticated browser acceptance. Users are tenant-wide
  and have no authoritative dated outlet membership; do not invent home outlets
  from departments or selected UI context. PayrollPlan/Version/ConfigurationEvent
  are the only new payroll models; authoritative CP monthly bases and frozen inputs
  are not yet integrated. Preview remains explicitly unavailable rather than using
  legacy payable totals. Resolve that dependency within CP-003 before claiming DONE.
- No schema changes, application DB operations, activation, dependencies, deployment,
  commit or push. CP-003 remains IN PROGRESS; do not start CP-004 automatically.

## October 27, 2026 — CP-003 profile and settings forms continuation

- Replaced JSON-only salary profile, staff employment date/stage override and salon
  settings controls with existing Input/Select/Checkbox components. Exact monetary
  strings and nullable/zero override semantics are preserved. Shared schemas block
  invalid dates, negative money, invalid percentages and out-of-range integers.
- Forms capture revision and values together. New server revisions retain local
  edits but block save until explicit reload; failures retain edits. Reload discards
  local edits and adopts current server values/revision. Existing owner-only writes,
  reason requirement, manager salary omission and company-context restriction remain.
- Removed JsonSettings. Pending requests/refetch disable form editing. Staff settings
  help clarifies that the stage-end override is supported only for two-stage plans.
  This is settings-screen integration, not staff create/edit workflow acceptance.
- Verification: full web **881/881** across 103 files, focused form/settings **22/22**;
  root production build, workspace typechecks, lint, source formatting and whitespace
  checks pass. Logs: `/tmp/cp003-forms-*`. Initial concurrent root build/typecheck
  collided while regenerating Prisma; rerunning sequentially regenerated the client
  cleanly and both passed. No schema edits or application DB operations occurred.
- No API/shared runtime changes, migration, activation, dependencies, deployment,
  commit or push. API regression/disposable acceptance and browser walkthrough were
  not run in this continuation. Legacy earnings remain unchanged.
- CP-003 remains IN PROGRESS. Next: metadata editor, staff create/edit integration,
  outlet assignment semantics, authoritative historical preview, richer version
  comparison, paginated audit and remaining API/UI/browser acceptance. Do not start
  CP-004 or infer historical payroll bases from legacy payable totals.

## October 27, 2026 — CP-003 structured definition editor continuation

- Added PayrollDefinitionEditor using existing UI controls. Stage names/ranges can
  be edited, added or removed with stable keys. Removing a stage clears its band
  overrides; remaining ranges are not silently rewritten and must pass validation.
- Structured incentive rules include type, individual metric types, scope, group
  metric and exact-string target/award rows. Add/remove rules and rows are supported;
  invalid definitions disable draft save. Category filters accept normalized unique
  comma-separated keys on blur; component ordering saves explicit sort positions.
- All changes use the existing revision-bound draft and reason-required save path;
  stale/manager/archived controls remain disabled. Advanced JSON remains optional.
- Fixed chart/calculator mismatch: payrollCommissionCurve accepts calculator options,
  and API/UI pass the selected stage. Chart labels disclose stage and method colors.
- Verification: full web **870/870**, 102 files, including **18/18** definition/settings
  tests; shared **243/243**; disposable service/HTTP acceptance **1/1**, including
  selected-stage chart parity. Root production build, all workspace typechecks/lint,
  source formatting and whitespace checks pass. Final logs: `/tmp/cp003-next-*`.
- Reused the existing disposable PostgreSQL 18 cluster on port 55474 for acceptance,
  then stopped it. No application DB changes, earnings activation, dependencies,
  deployment, commit or push. Full API regression and browser walkthrough not run.
- CP-003 remains IN PROGRESS. Still needed: metadata editor, structured salary/salon
  settings, staff create/edit integration/enforcement, richer version comparisons,
  paginated audit, outlet assignment semantics and authoritative historical preview.
  Do not infer historical base inputs from legacy payable totals. Resume CP-003,
  not CP-004. Prior checkpoint below describes the earlier implementation state.

## October 27, 2026 — CP-003 partial configuration checkpoint

- Added PayrollPlan, PayrollPlanVersion and immutable configuration-event storage;
  registered all three in tenant query scoping. Published versions and events are
  DB-protected against updates/deletes; unique publication dates and one draft per
  plan. Migration inserts no plans, configuration, activation or legacy backfill.
- Added authenticated `/api/payroll-configuration` routes. Owner-only configuration
  writes recheck current role/disabled/2FA and effective tenant write state under
  the shared commission configuration lock. Manager reads omit salary profiles and
  salary audit payloads. Reasons and expected revisions are required; publication
  validates complete definitions and rejects historical/locked-period changes.
- Plan create, metadata service, duplicate, archive, draft and publish; append-only
  company-wide assignment timelines, bulk assignment, staff join-date/override
  events, salary profiles and salon defaults. Employment date writes update User;
  reads use User.startDate, not an independently mutable staff mirror.
- Settings › Team & commissions includes sample draft creation, component/type/
  method/base/cap/band editing, stage rate overrides, JSON advanced definition,
  saved-version history, shared calculator/working lines, method comparison/chart,
  assignment history, profile/settings JSON editing and latest-100 audit disclosure.
- Verification: all migrations replayed from empty on isolated PostgreSQL 18,
  fresh clusters on ports 55473/55474, payroll_configuration_test. Final corrected
  migration replay and opt-in service/HTTP acceptance **1/1** pass on port 55474
  covers lifecycle, invalid definitions/reasons, stale revisions, publication race,
  DB immutability, tenant/outlet/role/salary isolation, last-day assignment selection,
  locked periods and calculator parity. Focused UI **49/49**; full web **859/859**
  across 101 files. Shared **242/242** including five new contract tests. Tenant
  model registry **4/4**. Root production build, API/web typechecks and API/web lint
  pass. Workspace lint, source Prettier and git diff whitespace checks pass;
  post-format UI **7/7** and final corrected-migration acceptance **1/1** pass.
  A repeat run exposed trigger access to version-only columns on event rows;
  nested table/operation branches fixed it without weakening immutability assertions.
- Remaining: true historical impact preview requires authoritative base inputs and
  closed-result inputs; do not fabricate it from legacy payable commission totals.
  Outlet plans can be configured but cannot yet be assigned: staff are tenant-wide,
  so membership/assignment semantics need implementation. Structured stages,
  incentives, categories/order/metadata editors, staff create/edit integration,
  stage-aware chart, richer version comparison, paginated history and further
  acceptance remain. JSON controls are interim, not final SRS UI acceptance.
- No application DB migration, earnings/POS activation, browser walkthrough,
  deployment, dependencies, commit or push. Full API regression not run.
  CP-003 stays IN PROGRESS; resume it next. CP-004 is not started.

## October 27, 2026 — CP-002 calculation engine

- Added `packages/shared/src/commission-payroll/` and public shared exports:
  strict Zod contracts, bigint rational arithmetic, flat/whole/slice/mixed/fixed-unit
  components, caps and working lines, tenure stages/schedule, last-day assignment/
  version selection, scoped incentives, monthly pooling, fallback and fixed awards,
  carry mapping/write-off, method comparison, chart data and impact preview.
- Added pure Hair/TP examples without seeding. Historical Stella sales-value and
  Alvin half-base examples remain distinct from new-policy fixtures (1,931.84 / 0
  Stella commission/incentive and 1,187.69 Alvin commission).
- Four-decimal source/base precision and half-up two-decimal components; split
  residuals use stable staff-ID ordering; fractional units prevent full fixed-unit
  awards to every recipient. Value-package cumulative ratio differences reconcile.
- Fallback requires existing source-time resolved rate evidence. Negative fallback
  debt is preserved at ten decimals, never repriced; switching debt to plan earnings
  fails until explicitly settled. Removed component carry needs reasoned mapping or
  write-off. Missing staged join dates and missing scoped group metrics fail closed.
- Verification: 36 new focused engine tests; full shared suite **237/237**, 59
  suites, zero failures/skips. Shared TypeScript noEmit, build and ESLint exit 0.
  Prettier and git diff whitespace checks pass. Compiled package-root export smoke
  check reproduces 546.40; final source inventory/placeholder and diff-scope checks
  pass. Only the new engine, public export and management documents were edited.
- Limits: engine-only calculation acceptance for TC-01–08, TC-13–15, TC-17,
  TC-21–25. No API/POS, transaction/permission, approval/export, browser or target
  performance acceptance. Stage jump warnings describe standard rates; snapshot
  inputs, authorization and carry settlement/audit remain service responsibilities.
- CP-002 is DONE; stop here. CP-003 is next, not started. A Word lock file appeared
  during the session and was left untouched; no unrelated application files edited.

## October 27, 2026 — CP-001 management initialization

- Created PROJECT, TASKS, DECISIONS, REQUIREMENTS and this handoff alongside the
  supplied sources. Root management pointers now select the CP workstream first.
- Moved seven former tracker files to the archive without changing their contents,
  including uncommitted documentation edits. Added an archive notice. Historical
  relative links inside the archive may be stale and are not active instructions.
- Extracted and inspected top-level SRS/developer instructions using standard-library
  DOCX XML reading. Top-level and bundled SRS hashes match. Mapped all functional
  requirement IDs, NFR-01–NFR-07 and TC-01–TC-25 to delivery tasks.
- Resolved open-point defaults, real Excel/PDF vs CSV gap, historical/new-policy
  fixture differences, tenant/transaction/retry issues, full statement freezing,
  departed staff and payout semantics. Embedded diagrams/demo browser visuals remain
  unverified; no supplied test-count or production-readiness claim is adopted.
- Verification: Prettier on all nine management/notice files and git diff whitespace
  check pass. Local Markdown links resolve. Coverage check finds all 87 functional
  IDs mapped; TC-01–TC-25 and NFR-01–NFR-07 are present. SHA-256 checks confirm
  all seven archived files, 73 delivered source files and 661 application TS/TSX
  files unchanged. Actual root diff reviewed: only top-level project pointers changed;
  existing history and unrelated sale UI changes remain intact.
- No runtime tests run: this task changes management documents and relocates the old
  tracker only. No engine/feature acceptance or application build is claimed.
- CP-001 is DONE; stop here. Next session may select CP-002; it is not started.
