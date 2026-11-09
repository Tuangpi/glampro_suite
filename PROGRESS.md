# Glampro Suite — progress

## Current state

- The extra salon tenants were automated test fixtures, not duplicate demo seeds.
  API tests now require a separate disposable `TEST_DATABASE_URL`.
- Commission/payroll status and operational gates live in the
  [feature checklist](docs/commission_payroll/TASKS.md), not this evidence log.
- Existing application tenants and immutable business records were not cleaned up.

## November 9, 2026 — Ubuntu VPS CI/CD configuration

- Added GitHub CI, scanned versioned GHCR releases, manual production deploy/rollback,
  container definitions and isolated deployment-script regression tests. Setup and
  limitations: [CI/CD guide](docs/operations/CI_CD.md). No VPS or database changes.
- Passed formatting, lint, typechecks, application build, 348 shared tests,
  actionlint workflow validation, Compose configuration validation, and mocked
  deployment/recovery tests. Docker daemon unavailable: images/startup not verified.
- Full web suite: 1361 passed, 5 failed (4 payroll timeouts and an appointment text
  assertion). Isolated rerun: 44 passed, appointment assertion still fails.
  API integration tests blocked by missing disposable `TEST_DATABASE_URL`.
- Security baseline flags existing unsafe Prisma raw-query calls for review;
  npm audit reports 14 advisories (13 moderate, 1 high). No exception or
  application-code changes made. Trivy/ClamAV and GitHub/VPS
  execution remain unverified. CI is intentionally blocking, not bypassed.

## November 9, 2026 — full-page sale history

- Replaced the history drawer with `/sale/history` and full-page receipt routes,
  responsive results, server-side receipt/customer search, status/date filters,
  URL pagination, and loading/error/retry/empty states. No new sidebar item.
- Reused draft storage and existing receipt actions. Route tests cover browser
  Back, filter/page restoration, active carts, resumed holds and read-only access.
- Verification: shared suite 348 passed; focused web suite 117 passed across sale,
  receipt, collections and tip tests; web/API typechecks and builds passed.
- Added database filtering/pagination/tenant/outlet regression coverage, but its
  execution is blocked by missing `TEST_DATABASE_URL`. No application database
  fallback, migration or data cleanup was attempted. Authenticated visual and
  real database acceptance remain outstanding.

## November 8, 2026 — prevent squeezed cart items

- Supersedes the fixed-height workspace below: removed the sale page's desktop
  height limit and the cart body's nested scrolling/flex-shrink constraints.
  The cart grows naturally with its items and expanded editors; shorter screens
  scroll the page. Catalogue browsing retains its own sticky desktop viewport.
- Reduced cart header padding, removed the empty description spacing, and
  compacted totals/footer spacing. Desktop checkout footer sticks to the bottom
  of the viewport while within the cart. Financial rules remain unchanged.
- Verification: 175 sale-related tests passed across 16 files; web ESLint and
  production build (including TypeScript) passed. Regression tests cover 1/3/6
  rows and the absence of fixed-height/nested-scroll constraints.
- Temporary headless Chrome fixture rendered the actual CartPanel with sample
  data: 12 checks covering 1/3/6 rows and an expanded editor at actual CSS
  viewports 1366×625, 1024×457 and 500×701. Every row fit inside the natural cart
  body, with visible overflow and no internal scrollbar. Three-row body measured
  548px, six-row body 1097px; header 47px and footer about 106px. No app data or
  authentication was accessed. Full authenticated sale-page acceptance remains
  unverified; the fixture and measurement output are temporary files in /tmp.

## November 8, 2026 — catalogue-first browsing and compact cart

- Widened the catalogue, tightened responsive item cards and kept desktop search
  and category controls sticky. Cards highlight added items and show quantities
  summed across matching cart lines; member-price hints wrap on narrow cards.
- Cart rows now expose item/price/quantity and named staff allocation summaries,
  with unassigned/unavailable staff visible. Item name or Edit details opens one
  inline editor at a time for therapist, discount, attribution and estimates.
  Quantity/remove/payment remain directly accessible; opening/closing editors
  does not change financial or assignment values.
- Department filtering was not added: the bounded POS search contract supports
  kind/search, not department filtering. No misleading current-page-only filter,
  new dependency, API contract, database or financial-policy change was introduced.
- Verification: 172 sale-related tests passed across 16 files; web ESLint and
  production build (including TypeScript) passed. Coverage includes added-card
  quantities, one-row editing, unavailable staff, discounts and appointment
  therapist/payment handoff. Authenticated browser/viewport checks were not run.

## November 8, 2026 — focused sale workspace

- Desktop POS now uses a viewport-bounded two-column workspace with separately
  scrolling catalogue/cart items and a non-scrolling totals/payment footer.
  Smaller screens retain page scrolling and the existing cart shortcut.
- Customer selection remains above the cart. Packages/credit and personal
  commission progress open in focus-managed drawers; redemption still hands the
  selected holding into the existing payment dialog. Cashiers are not offered
  personal commission progress.
- Cart lines show item/price/quantity/therapist before attribution controls.
  Saved staff allocation summaries remain visible; commission estimates are
  mounted only when expanded. Search now names the selected catalogue category.
- Verification: 169 tests passed across 16 sale-related files; web ESLint,
  production build (including TypeScript), and Git whitespace checks passed.
  Added drawer handoff/cancellation, focus, role visibility, layout structure,
  search scope, line ordering and estimate disclosure regression coverage.
- No API, financial-policy, database, or dependency changes. Authenticated
  browser/viewport checks and database integration checks were not run.

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

## November 9, 2026 — receipt counter layout

- Moved checkout confirmation above the receipt, promoted New sale/Back to cart,
  clarified payment hierarchy, and placed payment first on mobile. Refund/void
  evidence remains visible in the receipt header; management actions are collapsed.
- Grouped post-sale records without hiding collection balances or uncertain retries.
  Standard/thermal print layouts retain header, items, then totals. No financial
  contracts, API behavior, dependencies, or database operations changed.
- Full web run: **1,350 passed / 6 failed**. Receipt tests **12/12** and sale-page
  tests **69/69** passed. Five payroll-plan failures passed on isolated rerun;
  the untouched appointment dragging-copy test still failed (isolated **44/45**).
- Web lint, build (including typecheck), touched-file formatting, and diff checks
  passed. Live authenticated browser and physical printer acceptance were not
  performed; component tests are not visual or physical-print evidence.

## November 9, 2026 — compact post-sale actions

- Replaced nested post-sale cards with grouped rows. Settled receipts retain the
  authoritative balance while allocation evidence and empty history move under
  Details. Read errors, collection-blocking currency and uncertain retries remain
  visible; collection validation, confirmation and idempotency are unchanged.
- Moved direct-tip entry into Add tip; reused the styled native selector with
  alphabetical names and explicit staff loading/error/empty states. No automatic
  recipient choice or new staff-search dependency. Tip returns remain in history.
- Focused collection, tip, receipt and sale suites: **112/112 passed**. Web build
  (including typecheck), lint, touched-file formatting and diff checks passed.
  Full web suite and live browser visual acceptance were not rerun for this slice.
  No database operations or changes to financial contracts were performed.

## November 9, 2026 — common company receipt

- Print, shared links and HTML email now use one customer-safe shared template and
  stylesheet, with company branding and sale-outlet contact information. Private
  sale notes/attribution are excluded. POS controls stay outside the document.
- Added optional receiptOutlet contact data from the existing sale relation; no
  schema migration. Saved GST registration is authoritative on every surface;
  email no longer invents a missing historical number from current settings.
- Headless Chrome fixtures retained 45 long lines at 720/302/219 px without
  horizontal overflow. This is layout-fixture evidence, not authenticated browser,
  email-client, secure-link HTTP or physical-printer acceptance.
- Shared suite **344/344**, sale page **69/69**, final receipt suite **13/13**, and
  pure API email renderer **6/6** passed. Shared build, API typecheck, web production
  build/typecheck, workspace lint, formatting and diff checks passed. Pure email
  tests used an unused isolated test URL, with no database reads or writes.
- No application database operations, deployment, payment or ledger changes were
  performed. Secure-link HTTP/database integration was not exercised in this slice.

## Earlier history

- [Full root history before this cleanup](docs/archive/2026-11-07/PROGRESS.md).
- [Commission/payroll verification history](docs/commission_payroll/history/PROGRESS.md).

Keep only current state and a few recent handoffs here. Put detailed financial
acceptance evidence in the feature records, not another duplicated session diary.
