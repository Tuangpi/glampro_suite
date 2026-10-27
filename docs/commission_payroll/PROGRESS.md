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
- Latest continuation: structured stage/incentive editors, category filters and
  component ordering implemented; chart now honors selected stage in shared/API/UI.
- Next: continue CP-003 metadata/profile/settings UX and staff integration, resolve
  outlet assignments, authoritative impact preview and remaining completion checks.
- Existing unrelated sale UI work is preserved and is not accepted as CP completion.

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
