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
- Latest continuation: revision-safe metadata editor; opt-in staff create→payroll
  continuation and edit payroll panel; keyed rule-version comparison; paginated
  audit API/UI with salary/outlet filtering. Configuration only; no earnings activation.
- Next: outlet assignment semantics, authoritative impact-preview input integration,
  staff requirement/concurrency enforcement and remaining API/UI/browser acceptance.
- Existing unrelated sale UI work is preserved and is not accepted as CP completion.

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
