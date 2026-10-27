# Commission & Payroll progress

## Current State

- Current task: CP-003 — IN PROGRESS, October 27, 2026.
- Most recently completed: CP-002 — DONE, October 27, 2026.
- Priority: this project before unrelated backlog. New requirements govern policy;
  existing authentication, tenant safety and exact-money integrity remain mandatory.
- Shared engine plus partial CP-003 configuration persistence/APIs/settings UI
  implemented. Migration replayed only on disposable PostgreSQL; application DB,
  POS/earnings, activation and deployment remain unchanged. No dependencies added.
- No policy question currently blocks local work; decisions adopted under delegation
  are in DECISIONS.md, including explicit deviations from SRS proposed defaults.
- Latest continuation: company owners can assign scoped published plans, including
  atomic staff creation. Assignment events snapshot outlet scope; inactive outlets
  and stale revisions are rejected. Shared partitioning separates combined eligible
  outlet pools and fallback activity without enabling earnings.
- Next: authoritative impact-preview input integration, remaining API/UI/browser
  acceptance and lifecycle concurrency coverage. CP-005 must integrate scoped
  statements, carry and incentive metrics before earnings activation.
- Existing unrelated sale UI work is preserved and is not accepted as CP completion.

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
