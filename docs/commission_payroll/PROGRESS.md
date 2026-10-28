# Commission & Payroll progress

## Current State

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
