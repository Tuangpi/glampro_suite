# Glampro Suite — progress

## Current state

- The extra salon tenants were automated test fixtures, not duplicate demo seeds.
  API tests now require a separate disposable `TEST_DATABASE_URL`.
- Commission/payroll status and operational gates live in the
  [feature checklist](docs/commission_payroll/TASKS.md), not this evidence log.
- Existing application tenants and immutable business records were not cleaned up.

## November 8, 2026 — simplified Reports page

- Reports is now one page: shared date filters, five business summary cards,
  charts, and Appointments/Sales/Products/Services/Packages detail controls.
  Removed Detailed sales, Staff & payments, Customer balances, and Daily close
  tabs, including their page-level hooks and operational panels. Supersedes the
  secondary-tab layout below; no replacement navigation is introduced elsewhere.
- Underlying APIs, hooks, standalone operational components and business records
  are unchanged. No migrations or data operations were performed.
- Verification: 33 focused web tests passed across 5 files; web ESLint and
  production build (including TypeScript) passed. Tests cover removed navigation,
  absence of extra report-hook calls, keyboard detail controls, date validation,
  loading/error/empty states and existing retained operational components.
- Authenticated browser and database integration checks were not run.

## November 8, 2026 — visual business reports

- Reports now opens a visual appointments/sales/products/services/packages
  dashboard with shared salon-local date presets, line/donut/stacked/horizontal
  bar charts, and category detail tables. Existing operational reports remain
  secondary tabs. Definitions: [business reports](docs/features/business-reports.md).
- Added complete server-side category/item totals and zero-filled hourly/daily
  series; exact-money totals, current booking statuses, outlet filtering, and
  separate package purchase/redemption counts. No schema migration or new dependency.
- Verification: 41 focused web tests and 6 pure backend/schema tests passed,
  including DST and totals beyond ten items. API type check, production web build,
  and web/API/shared ESLint passed. Local reports URL returned HTTP 200.
- No separate TEST_DATABASE_URL or installed browser automation package is
  available; database integration and authenticated visual-browser verification
  were not run. No application data, activation, payments or payouts changed.

## November 8, 2026 — consolidated Payroll workspace

- Settings now has Payroll with Commission progress and Monthly close tabs.
  Team & commissions contains only earning configuration. Existing close links
  still open close; old team-progress links redirect with month/parameters intact.
- Both tabs mount lazily and stay mounted after visiting to preserve close drafts.
  Same-month progress/close links use the new Payroll routes. My earnings and
  manager/owner/read-only access boundaries remain unchanged.
- Verification: 83 focused web tests across 7 files passed; production web build
  (including TypeScript), web ESLint, and diff whitespace checks passed.
- Navigation-only change: no database operations, earnings activation, approvals,
  payouts or calculation changes. Existing unrelated working-tree edits retained.

## November 8, 2026 — commission progress and close navigation

- Renamed This month to Commission progress. Uncalculated months say Not
  calculated, explain that missing results are not zero earnings, and omit the
  redundant missing-statement message. Refresh explicitly reads saved output.
- Added same-month in-app links between management progress and Payroll close;
  linked close months load without calculating. Self-service has no management
  link. Close actions invalidate current/explicit-month and self progress caches.
- Verification: 80 web tests across 7 files passed; 21 pure backend close/progress
  tests passed; web production build (including TypeScript), web ESLint, and
  `git diff --check` passed. Backend checks did not access a database.
- No separate TEST_DATABASE_URL is configured, so database-backed end-to-end
  verification was not run. No application data, activation, approvals, payouts
  or financial formulas were changed. Existing unrelated edits were preserved.

## November 8, 2026 — focused pay-plan list and editor

- Supersedes the section-link layout below. Pay plans opens a compact list with
  status, assignment count and Edit/View, Assign staff and History actions. The
  editor separates Details, Earning rules and Review; uncommon rules retain a
  visible summary behind disclosures. Templates, policies, historical impact,
  audit and technical tools are separate views. Activation is compact/read-only.
- Removed disconnected company deposit/refund fields, descriptive-only positions
  and raw outlet IDs from editors without deleting saved values. Salary and
  employment forms remain on staff profiles, not duplicated in Settings.
- Settings writes require an action-local audit confirmation. Failed requests
  preserve reason/draft; switching plans protects unsaved metadata/rules/JSON.
  Unrelated policy saves preserve rule drafts; assignment refuses unpublished
  or not-yet-effective-in-the-month plans. Assignment/profile UI is extracted to
  its own focused component with type-only configuration coupling.
- No application data, migrations, activation, payouts or financial formula
  changes. Authenticated browser and real-month reconciliation remain unverified.
- Verification: **111 tests / 6 files passed**, followed by **8 activation-status
  tests passed** including the new compact-layout check (112 distinct tests).
  Web TypeScript, web ESLint and production web build passed. Regression coverage
  includes hidden-value preservation, action confirmation/cancel/retry, stale
  revisions, draft/discard boundaries, scoped assignment, staff-profile saves,
  advanced rules and historical monetary preview/history navigation. A duplicate
  validation-message key warning found during tests was fixed and the clean
  suite rerun passed; no tests or validators were disabled.

## November 8, 2026 — clearer pay-plan workflow and truthful status

- Pay plans now explains setup, separates rules/staff/company policies with section
  navigation, and preserves mounted drafts. Sales types use plain labels; hints
  explain base percentages, tier methods, effective dates, salary and cost alerts.
  Technical calculation, version and tenure JSON is behind disclosure controls.
- The read-only activation card validates `/api/payroll-cutover` responses and
  distinguishes not activated, scheduled, active, rolled back and unavailable.
  It does not trust the configuration endpoint's hard-coded inactive placeholder.
  Invalid/missing activation evidence fails unknown, with retry, not inactive.
- Company-wide deposit/refund values remain visible but read-only because they
  are not operational defaults. Existing per-package deposit enforcement and
  explicitly supplied refund fees are unchanged. Missing-plan messaging now
  discloses that commission-earning staff can block monthly payroll.
- Verification: **92 web tests / 5 files passed**, covering activation states,
  malformed responses/recovery, editor navigation, saves, revisions and settings.
  Web TypeScript checks, web ESLint and production web build passed. Initial
  failures were isolated to parent mocks counting the new status API request;
  activation is tested independently and parent mocks now isolate that boundary.
- No authenticated browser acceptance, database integration tests, real-month
  reconciliation, migration, payroll activation, payout or application-data writes
  were performed. Operational release gates remain open.

## November 8, 2026 — actionable pay-plan security requirement

- Payroll configuration now returns `OWNER_TWO_FACTOR_REQUIRED` for an owner
  without email verification. Pay plans presents setup guidance and a direct link
  to account security rather than a generic request error. Other failures retain
  the existing error/retry state; authorization is unchanged.
- Verified accounts get a fixed internal Back to Pay plans action; account-state
  changes reload the configuration. Active team tabs render after URL navigation
  even when Settings kept the team category mounted; visited drafts remain mounted.
- Verification: **79 web tests / 3 files** pass serially. An initial return-flow
  regression exposed the active-panel issue; a concurrent build/test run also hit
  an unchanged metadata-test timeout. Both pass in the final focused rerun.
- Added a dedicated-code assertion to the disposable CP-003 acceptance suite; it
  was not executed because no approved disposable database target was established.
  No application database changes, browser/provider acceptance or deployment.

## November 8, 2026 — responsive account-security enrollment

- Email verification setup opens immediately with sending feedback, a sent toast,
  retry/resend controls, and a setup-in-progress badge. The switch stays off until
  the six-digit code is confirmed and the account profile is refreshed.
- Cancelling a send ignores its late success/failure; submitted verification cannot
  be dismissed mid-request. Existing owner/staff policy and backend guards remain.
- Verification: **59 tests / 4 files** pass (account security, Settings, Switch,
  Modal); web typecheck, targeted ESLint, touched-code formatting, production build,
  and diff checks pass. No browser/provider delivery or database acceptance performed.

## November 8, 2026 — staff-first commission configuration

- Added individual default-rate editing under Staff → Commissions with explicit
  custom/inherited/unconfigured states. Exceptions and history are secondary.
- Settings opens Company rules; Rate overview is read-only until Bulk edit rates
  is selected, with direct links to staff profiles. Existing publishers, audit
  reasons, effective dates, revision checks and permissions remain unchanged.
- Workflow details: [staff commission settings](docs/features/staff-commission-settings.md).
- Verification: all **1,309 web tests / 140 files** pass with `--maxWorkers=2`;
  web typecheck, lint, touched-file formatting, production build and diff checks pass.
  Initial concurrent build/full-suite execution had five unchanged PayrollPlans
  test timeouts; the lower-concurrency full rerun passes without changing timeouts.
  No live browser or database acceptance was performed.
- No database operations, earnings activation or production deployment performed.

## November 8, 2026 — documentation consolidation

- Grouped maintained guides into development, operations, features, assistant,
  and decisions; updated the documentation index and relocated-file links.
- Separated commission/payroll acceptance evidence, historical handoffs, and
  unchanged supplied references. Added a short current feature checklist and
  replaced competing root status summaries with links to it.
- Preserved detailed checklists, stable IDs, approved policy, and release gates.
  This is documentation maintenance, not fresh application acceptance or release.
- Verification: 216 local Markdown links, including section anchors, resolve;
  all 73 supplied commission assets match their Git originals byte-for-byte.
  Maintained Markdown formatting and `git diff --check` pass. No application
  tests or database operations were run for this documentation-only change.

## November 7, 2026 — first incremental code refactor

- Extracted read-only POS catalogue search from `sale.service.ts` into
  `sale-item-search.service.ts`; preserved its existing public export and all
  query/filter/order/schema behavior. Shared `sale-item-policy.ts` keeps search,
  checkout, and held-cart module mapping aligned.
- Sales service reduced from 3,795 to 3,443 lines. Financial transactions, routes,
  permissions, schemas, and business policy were not redesigned. Further large-file
  candidates are recorded in tasks, not silently included in this change.
- Added compatibility, entitlement, barcode normalization/deduplication, and
  inclusive low-stock regression tests. Focused search **10/10**; full API on a
  separately migrated disposable PostgreSQL **1,322 passed / 276 opt-in skips /
  0 failed**. API typecheck, lint, and build passed.
- Compared extracted code and financial section against the pre-refactor source;
  only policy naming and equivalent existing decimal formatting changed there.
  No application database operations or frontend changes.

## November 7, 2026 — documentation cleanup

- Added a root README, grouped docs index, and commission/payroll entry point.
- Replaced the 9,333-line root project/task/progress set with short current
  summaries; preserved the complete previous records in the
  [dated archive](docs/archive/2026-11-07/README.md), rebasing Markdown links.
- Kept feature specifications, accepted decisions, detailed acceptance evidence,
  supplied assets, and existing code changes intact. No database operations.
- Documentation validation results are recorded in the completion report; no
  application tests are implied by this documentation-only change.

## November 7, 2026 — test database isolation

- API test preload requires a safe local `TEST_DATABASE_URL`, distinct from the
  application database name. Prisma also guards direct test-runner imports.
- Mock suites preserve the selected connection. Setup and regression coverage
  are documented in the [seed/test guide](docs/development/demo-seeding.md).
- Executed on separate disposable PostgreSQL: full API **1,317 passed / 276
  opt-in skips / 0 failed**; final safety suite **8/8**. API typecheck, lint,
  build, touched-file formatting, and diff checks passed.
- Read-only verification confirmed the application still had the same 16 tenants.
  No application migration, seed, or cleanup was run. Test PostgreSQL was stopped.

## November 7, 2026 — departments

- Added manager/admin department management, safe delete/unassign preview,
  transactional recheck, and audit. Commission references block deletion;
  business history and other memberships survive. No migration.
- Recorded checks: API HTTP suite **14/14**, focused web/shared checks, builds,
  lint, formatting, and diff checks. Full-suite/browser UAT was not performed
  for this feature. See [department contract](docs/features/departments.md).

## November 7, 2026 — CP-008 reports

- Implemented per-holding residual value/conditional exposure and original
  sold-session counts, closing the earlier audit-only OPEN checkpoint.
- Recorded full verify: API **1,298 passed / 276 gated skips**, web **1,268/1,268**,
  shared **337/337**; PostgreSQL/HTTP **11/11**, mounted Chrome **17/17**; builds passed.
- These are historical executed results, not fresh verification for later changes.
  Scope and limitations: [report audit/delivery](docs/commission_payroll/acceptance/CP008_REPORT_AUDIT.md).
  No production activation, migration, or approved-payroll rewrite was authorized.

## Earlier history

- [Full root history before this cleanup](docs/archive/2026-11-07/PROGRESS.md).
- [Commission/payroll verification history](docs/commission_payroll/history/PROGRESS.md).

Keep only current state and a few recent handoffs here. Put detailed financial
acceptance evidence in the feature records, not another duplicated session diary.
