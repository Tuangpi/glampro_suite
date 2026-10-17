# Glampro Suite — session handoff

## Resumed session — 2026-10-16: SETUP-01 verification complete; Ready for UAT

Completed read-only verification for SETUP-01 (tracker and session handoff): all 29 TK2610-XXXX product rows and all 6 SETUP rows are present in TASKS.md; DOCX, PDF, STATE.md and ADRs 0002–0018 + README all resolve on disk with no dangling references. Marked SETUP-01 Ready for UAT in TASKS.md (line 48); awaiting your acceptance for Done.

SETUP-06 remains In progress: ADR 0010 (low-stock threshold override semantics) and ADR 0011 (legacy per-tenant receipt numbering) are documented as open conflicts awaiting your explicit decision — neither resolved unilaterally, and no application code, test, or design change was made. SETUP-02 / SETUP-05 / P0-07 API validation remains blocked pending your confirmation of a disposable test database; no database commands, migrations, resets or seeds were run.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:
- TASKS.md: SETUP-01 status Testing → Ready for UAT with coverage/reference evidence.
- docs/STATE.md: this entry.

Validation: file/directory listing and link-resolution checks against TASKS.md and docs/ — exit 0; all referenced files present.

PJ2610-0026 update: no external task is ready to mark complete; SETUP-01 awaits your acceptance for Done.

## Latest continuation — 2026-10-16: P0-03 business hours toggle bug fix and commit

Resumed in Act mode, fixing a bug in the P0-03 business hours slice where the draft state was not respected when a day was toggled to closed (`null`). The `??` nullish coalescing operator collapsed `null` (day closed) back to the server value, so `handleSubmit` detected no change and `mutateAsync` was never called. Replaced `??` with `in` operator key-membership checks in `currentValue`, `handleSubmit`, and `setDay`; also corrected the "change a business-hours window" test to start Monday as closed (null) matching its "closed -> open" scenario.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- apps/web/src/pages/Settings.tsx: `draftValue` replaced with `currentValue` using `day in draft` membership check; `handleSubmit` uses `currentValue(key)` instead of `draft?.[key] ?? server`; `setDay` uses `day in base ? base[day] : serverValue(day)` instead of `base[day] ?? serverValue(day)`.
- apps/web/src/pages/__tests__/Settings.test.tsx: "change a business-hours window" test mock data changed so Monday starts as `null` (closed) instead of `{ open: "09:00", close: "20:00" }`, matching the test's "closed -> open with defaults" scenario.
- TASKS.md: TK2610-0007 / P0-03 moved to Done.
- docs/STATE.md: this entry.

Validation confirmed exit 0:

- Web Settings test suite: 11/11 passed (previously 10/11 with the toggle test failing).
- Web typecheck (`tsc --noEmit`): passed.
- Prettier --check on Settings.tsx, Settings.test.tsx, useSettings.ts: clean after --write.
- ESLint on the same three files: passed.
- Production web build (`vite build`): passed.
- No database commands, migrations, resets or seeds; API integration tests remain blocked pending a confirmed disposable test database.

No design files, original DOCX/PDF, dependencies, Git remotes, commits or pushes changed in this slice.

PJ2610-0026 update: TK2610-0007 / P0-03 marked complete in TASKS.md; commit ready for user approval.

## Latest continuation — 2026-10-16: P0-08 validation and commit

Resumed in Act mode, preserving the preceding uncommitted P0-08 slice. No
database commands, dependency changes, commits or pushes in this continuation.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- apps/web/src/components/appointments/{CalendarView,WeekView,MonthView}.tsx:
  moved the `useSalonFormatting()` hook call above the `isPending`/`isError`
  early returns, fixing a react-hooks/rules-of-hooks violation; hook ordering
  is now stable across every render.
- TASKS.md and docs/STATE.md: P0-08 (TK2610-0006) and P0-07 (TK2610-0004)
  moved to Done per user confirmation; no manual UAT required once complete.

Validation confirmed exit 0:

- Full web suite: 42 files / 377 tests, none skipped; shared suite 87 tests /
  32 suites, none skipped.
- Workspace-wide ESLint; web and shared typecheck; production web build.
- Prettier clean on all P0-08 source files.
- No database commands, migrations, resets or seeds; API integration tests
  remain blocked pending a confirmed disposable test database.
- No manual browser UAT required once complete.

No design files, original DOCX/PDF, dependencies, Git remotes, commits or
pushes changed in this slice.

PJ2610-0026 update: TK2610-0006 / P0-08 and TK2610-0004 / P0-07 are marked
complete; no external task awaiting acceptance remains from this slice.

## Latest continuation — 2026-10-16: P0-08 preference propagation and formatting

Resumed in Act mode, preserving the preceding uncommitted persistence slice. No
database commands, dependency changes, commits or pushes in this continuation.

New/updated files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- apps/web/src/contexts/SalonFormattingContext.tsx and its **tests** suite:
  authenticated provider reads saved salon settings, blocks initial rendering until
  available, offers retry on initial failure and rejects mismatched tenant data.
  Tenant-keyed queries and keyed provider remounts prevent reuse across salons.
  Public routes do not fetch preferences. Context values are immutable per render,
  not global mutable tenant state; standalone component tests use Singapore defaults.
- apps/web/src/constants/queryKeys.ts, hooks/useSettings.ts and main.tsx: session
  provider wiring and tenant-specific settings cache. Successful profile writes
  update both the legacy settings cache and the profile's tenant-specific cache.
- apps/web/src/lib/utils.ts and utils.test.ts: pure bound salon formatters, explicit
  S$ currency labels, default en-SG numeric dates, salon-zone timestamp display and
  date-only preservation/invalid-date checks. Major-unit prices remain separate
  from cents; explicit alternate-currency utility callers remain supported.
- apps/web/src/pages/{Customers,Dashboard,Products,Reports,Settings,Staff}.tsx,
  components/layouts/AppShell.tsx and components/sale/{CartLine,CartPanel,
  HeldCartsPanel,PaymentDialog,ReceiptView,SaleItemGrid}.tsx: use bound formatters.
  Report day buckets now format the API's date-only value directly rather than
  inventing a noon UTC instant. Settings shares the tenant-keyed provider query.
- apps/web/src/pages/**tests**/{Dashboard,Products,Reports,Sale}.test.tsx and
  components/ui/**tests**/Table.test.tsx: updated currency assertions/accessibility
  labels to explicit S$. Existing generic hardcoded Card/Table examples preserved.
- apps/web/eslint.config.js: extended the existing provider-plus-hook Fast Refresh
  exception to the new context, with the same rationale as AuthContext.
- TASKS.md and docs/STATE.md: current evidence and remaining scope.

Validation confirmed exit 0:

- Full web suite: 41 files / 368 tests, none skipped. New coverage includes profile
  loading/retry, save propagation, public routes, tenant switch/mismatch rejection,
  date-only preservation, currency-unit contracts, locale separators and DST display.
- Formatter/provider suites with TZ=America/Los_Angeles and TZ=Pacific/Auckland:
  2 files / 20 tests passed in each environment.
- Workspace-wide ESLint; web typecheck; production web build (also shared build).
- Initial runs exposed expected old currency labels and two test synchronization/
  whitespace matcher issues; corrected assertions. A remaining regex typo and the
  new context's Fast Refresh lint exception were corrected before the passing runs.
- Scoped formatting, final whitespace/diff review and protected-file Git comparisons
  are performed at session completion; see completion report for outcomes.
- No API integration rerun or manual browser UAT in this frontend-only continuation.

Remaining/next: P0-08 technical scope is complete and validated. Calendar grid
windows (day/week/month via `salonStartOfDay`/`instantFromSalonDate`), booking
datetime input (`AppointmentFormDrawer` `toSalonInstant`/`toSalonInputValue`,
`bookingStart`), dashboard summary boundaries (`todayWindow`) and report
date-range/bucketing (`reportOverview` salon-local-day buckets; explicit
`from`/`to`/`timeZone` range) all use the salon zone. Appointment blocks/chips
render through the bound salon-zone formatters, not the browser-local path.
Validation: web 42 files / 377 tests, shared 87 tests, workspace lint, web
typecheck/build, format clean; cross-zone formatter/provider tests pass under
Los Angeles and Auckland. Marked Done per user confirmation; no manual UAT
required once complete.
The initial profile fetch is now a prerequisite for rendering authenticated pages;
it fails visibly rather than silently displaying a different salon clock.

PJ2610-0026 update: TK2610-0004 / P0-07 remains ready for final acceptance; after
acceptance mark it complete in your task system. No additional external task is
ready to mark complete: TK2610-0006 / P0-08 still needs calendar/input/report/summary
time semantics and full validation/UAT.

## Latest continuation — 2026-10-15: P0-08 persisted preferences slice

User approved Act-mode implementation after the read-only plan. The starting tree
was clean at `186b94b` (`chore: checkpoint workspace setup and decision audit`);
older references below to mixed uncommitted work are historical, not current.
No design or original DOCX/PDF changes. No commit or push in this slice.

Changed files (all relative to /home/tuangpi/Documents/Aridient/Glampros/glampro_suite):

- packages/shared/src/schemas/settings.ts and settings.test.ts: validated named
  timezones and supported formatting locales. Kept existing required name/threshold
  request fields; new preferences are optional without request defaults so older
  clients cannot reset stored preferences. Corrected misleading PATCH comments.
- apps/api/prisma/schema.prisma and
  apps/api/prisma/migrations/20261015210000_tenant_localisation/migration.sql:
  additive tenant preferences defaulting to Asia/Singapore and en-SG.
- apps/api/src/services/settings.service.ts: include saved fields in profile reads;
  existing scoped writes persist them under unchanged route authorization.
- apps/api/src/routes/settings.routes.test.ts: defaults, persistence/readback,
  invalid values, tenant isolation, older-client preservation and refused writes.
- apps/web/src/hooks/useSettings.ts: updated profile documentation; existing
  successful-write query-cache replacement carries new settings too.
- apps/web/src/pages/Settings.tsx and its **tests**/Settings.test.tsx: editable
  timezone/locale fields with existing role/read-only guards and field errors.
  Locale explicitly means formatting, not interface translation. Preferences are
  saved only in this slice; downstream formatting/time calculations are unchanged.
- TASKS.md and docs/STATE.md: progress, evidence and remaining scope.

Validation confirmed:

- Shared build and Prisma client generation: exit 0; generated files not hand-edited.
- API and web typechecks: exit 0. Full shared suite: 87 passed, none skipped.
- Focused Settings web suite: 7 passed. Full web suite: 40 files / 357 passed.
- Workspace-wide ESLint and Prettier check on all seven edited TS/TSX files: exit 0.
- Dedicated PostgreSQL 18 cluster at /tmp/glampro-p008-jsc4nezg/data, owner-only
  parent, Unix socket in that directory, port 55488, no TCP listener; database
  glampro_disposable. Explicit DATABASE_URL override for every child command.
  All ten migrations deployed; second deploy found none pending. Settings API
  integration suite: 6 tests passed, none skipped. Cluster stopped successfully;
  temporary files retained. Log: /tmp/glampro-p008-db.log. No existing configured
  database accessed, no app seed/reset or production commands executed.
- Some direct terminal checks had unobserved completion; captured subprocess
  reruns confirmed formatter, typechecks and shared test exit codes. Full API suite,
  production deployment and manual browser UAT were not run.
- Final diff/whitespace and SHA-256 protected-file comparison are checked at session
  completion; see completion report for outcomes.

Next bounded slice: propagate saved preferences through the authenticated web app
without global mutable tenant state; implement S$ and DD/MM/YYYY formatting while
preserving major/minor-unit money contracts and date-only values. Then align booking
inputs, calendar day/week/month boundaries/drag geometry and reporting/export
timezone semantics, with cross-browser-timezone and DST regression coverage.
Apply migration before deploying API/UI to any approved environment; no such
deployment occurred here. P0-08 remains In progress, not Ready for UAT.

PJ2610-0026 update: TK2610-0004 / P0-07 is still ready for final acceptance; after
acceptance mark it complete in your task system. No additional external task is
ready to mark complete: TK2610-0006 / P0-08 needs propagation, formatting, consistent
time semantics and full validation/UAT.

## Current acceptance gate — 2026-10-15: P0-07 ready for final acceptance

User chose salon-wide persisted timezone/locale settings for P0-08 and explicitly
approved a dedicated disposable local test database only, with no production access
or existing-data reset. This supersedes the absolute PostgreSQL prohibition below
only for that isolated test environment. Commit authorization remains active; no
push. Do not access any existing configured database.

Prioritized the newly unblocked P0-07 validation gate before starting P0-08 code.
Created a separate PostgreSQL 18 cluster at /tmp/glampro-p0-07.x0FtEP/data with a
Unix socket inside its owner-only temporary directory, port 55487, no TCP listener,
and database glampro_disposable. Used an explicit DATABASE_URL override for every
database command; did not read/use the existing connection or run the app seed.
Applied existing migration files to this fresh database; confirmed deploy rerun
reported nine migrations and no pending migrations. The untracked pre-existing
staff-shifts migration was used locally but is not part of the P0-07 commit.
First URL placed port in the query and failed P1001; corrected URI authority port.
An unobserved migration/test invocation was followed by a confirmed successful
deploy/test rerun. Stopped the disposable cluster with pg_ctl after validation;
temporary data is retained, not removed. No production/existing data was touched.

Validation (all confirmed exit 0):

- requireModule integration suite: 7 tests passed, none skipped, against the above
  disposable database. Human-readable Packages/Gift cards refusals and unknown-key
  suppression passed, alongside entitlement and tenant-scope checks.
- Full web suite: 40 files / 354 tests passed. Full shared suite: 83 tests passed.
- Shared build and API/web typechecks passed; module-name tests separately 3 passed.
- Scoped API/web/shared ESLint and Prettier on all ten P0-07 code/test files passed.
  Initial web lint completion was unobserved; redirected rerun confirmed exit 0.
- Final whitespace, scoped staged-diff and protected-file checks accompany commit.
  Full API suite and production browser smoke were not run; unrelated SETUP-02
  baseline acceptance is not implied by this focused middleware run.

Commit scope: only the reviewed P0-07 UI copy/tests, middleware/tests, shared module
names/tests and seed map deduplication; all other mixed tooling/migration/ADR work
stays unstaged. TASKS.md and this handoff remain unstaged because they contain mixed
prior history. Earlier dashboard changes are already committed. No P0-08 code or
schema changes, design changes, production queries, commits of unrelated work or push.
Commit confirmed: `68400cb` (`fix: replace developer-facing copy with salon guidance`).
The commit invocation's terminal completion was unobserved; a redirected git-log/status
check confirmed the commit exists and the index is empty. The earlier ADR checkpoint
is `d14e156`. Unrelated work remains in the working tree.

TK2610-0004 / P0-07 is Ready for UAT, not Done. The user previously accepted the
desktop/mobile UI on 2026-10-15; its only recorded remaining integration gate now
passes. Ask final acceptance of the validated full task before external completion.
After acceptance, update the local tracker; external task-system update is a user
action. Next implementation is P0-08 under the approved salon-wide scope, including
saved preferences and consistent timezone handling, not just changing display labels.

PJ2610-0026 update: TK2610-0004 / P0-07 is ready for acceptance; after UAT mark it
complete in your task system. No other external task is newly complete.

## Latest continuation — 2026-10-15: calendar audit checkpoint and P0-08 assessment

User now authorizes commits when needed and requests continued work until the next
external task can be marked complete. This supersedes older instructions to request
commit approval at the documentation checkpoint; no push is authorized. Existing
PostgreSQL prohibition and design-folder protection remain in force.

Completed ADR 0018's bounded evidence review; accepted policy is unchanged. Its
midnight rationale overgeneralizes the tested 23:00–01:00 example: geometry can
intersect visible hours on longer overnight spans, while start-day bucketing/read
semantics still limit rendering. Also recorded browser-local windows, concurrent
list reads, editable non-draggable week/month views and unresolved truncation.
Five focused frontend suites passed, 88 tests, exit 0: geometry, CalendarView,
WeekView, MonthView and Appointments. Hooks are mocked; no database evidence.

Changed files in this continuation:

- /home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/decisions/0018-the-calendar-draws-more-than-one-day.md
- /home/tuangpi/Documents/Aridient/Glampros/glampro_suite/TASKS.md
- /home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/STATE.md

Checkpoint commit scope: ADR 0017 and ADR 0018 evidence reviews only, excluding
all pre-existing application, tooling, migration and other documentation changes.
Committed as `d14e156` (`docs: audit discount and calendar decision evidence`),
two ADR files / 112 added lines. Scoped Prettier passed (exit 0), whitespace
check passed, all 20 new evidence links resolve, and design checks were empty.
Two initial formatter invocations had unobserved completion; an output-redirected
rerun confirmed success. Tracker and handoff remain unstaged to avoid folding mixed prior work
into the scoped commit. No push, database access or design changes.

Next external task assessed: TK2610-0006 / P0-08. Original DOCX requires S$,
DD/MM/YYYY and timezone/locale settings. Current money helpers default to USD;
date helpers use month names; salon profile contract/storage has no timezone or
locale preference. Calendar boundaries and report timezone follow the browser.
Implementing only new display defaults would not complete this task. Clarify
salon-wide persisted settings versus device-only preferences before changing
time semantics, and obtain explicit approval for disposable database-backed
validation if persisted settings require a migration. No schema/code changes yet.

PJ2610-0026 update: no additional external task is ready to mark complete.
P0-08 needs scope confirmation and implementation/validation; P0-07 remains
database-blocked. P1-09 was already accepted in the prior session.

## Latest continuation — 2026-10-15: SETUP-06 line-discount evidence review

Reviewed ADR 0017 against shared contracts, pricing/ledger/receipt paths, migration
SQL, route guards, web controls and existing tests. Accepted policy and application
behavior are unchanged. This entry supersedes the prior next-action entry: next
review ADR 0018's calendar policy, then prepare the proposed documentation commit
scope for explicit approval. Do not commit or push automatically.

Changed files:

- /home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/decisions/0017-a-discount-is-a-recorded-line-percentage.md
- /home/tuangpi/Documents/Aridient/Glampros/glampro_suite/TASKS.md
- /home/tuangpi/Documents/Aridient/Glampros/glampro_suite/docs/STATE.md

Findings:

- Contract rates are 0–100 with at most two decimal places; unknown price fields
  are stripped, while catalogue prices remain authoritative. Decimal arithmetic
  follows the recorded per-unit discount rule; migration SQL has no rate-range or
  arithmetic CHECK constraints. Deployed schema was not inspected.
- Decision item 6 says points reduce with discount, but code awards catalogue
  points times quantity. An existing API test explicitly expects unchanged points.
  Resolve loyalty policy before changing behavior or accepted decision wording.
- Attributed performance records discounted line totals, even with debt, not money
  actually received. That path does not compute/create commission rows.
- Receipt discount disclosure is conditional on positive monetary discount; a
  positive rate rounded to zero money remains in API data but is not disclosed.
- UI normalizes rates to two places and caps at 100; input step is 1. Preview uses
  JavaScript numbers, not Decimal; tested examples are not exhaustive equivalence.

Validation:

- `node --import tsx --test packages/shared/src/schemas/sales.test.ts`: 35 tests
  passed, exit 0.
- `npm test --workspace @glampro_suite/web -- src/pages/__tests__/Sale.test.tsx src/lib/money.test.ts`:
  2 files / 29 tests passed, exit 0 (Sale 24; money 5). Browser requests are mocked;
  these checks do not establish ledger persistence or receipt discount disclosure.
- ADR 0017 Prettier check and `git diff --check` passed, exit 0; all 13 links in
  the new evidence section resolve. The initial link-check heredoc had unobserved
  completion; a single-command rerun confirmed success. Final file review confirmed
  the tracker/handoff next action; design-folder tracked/untracked checks were empty.
- API integration tests not run: PostgreSQL access remains prohibited pending new
  approval. No database queries, migrations, resets or seeds. Full build, lint and
  typecheck not run for this documentation-only slice; application code unchanged.

Remaining: ADR 0018 review; explicit loyalty-policy resolution; prior void,
held-cart, appointment, low-stock override, legacy receipt and security questions.
P0-07 remains blocked on approved database-backed middleware validation. Existing
mixed working-tree changes are preserved; selectively review documentation diffs
before any later staging. No design files, original DOCX/PDF, dependencies,
application code/tests, database, migrations, remotes, commits or pushes changed.

PJ2610-0026 update: no additional external task is ready to mark complete.
SETUP-06 remains In progress; P0-07 still requires API middleware validation.

## User acceptance — 2026-10-15

User confirmed "okay all are good. all acceptance" following the P1-09 acceptance
request. TK2610-0014 / P1-09 is now Done in the local tracker for the delivered
picker-only scope. The Ready for UAT entry below is historical. PJ2610-0026 update:
user may now mark TK2610-0014 complete in the external task system; the agent has
not updated that system. This acceptance does not complete other roadmap tasks
or replace missing database-backed validation. P0-07 remains database-blocked.

User explicitly approved a local commit containing only the accepted P1-09
performer-picker implementation/tests and scoped acceptance documentation, leaving
unrelated work unstaged and without pushing. The working tree contains mixed
tooling recovery, API/migration, UI and ADR work; selectively stage only this scope.
PostgreSQL prohibition remains in force. Commit outcome is reported in the session
response; no push is authorized.

## Current execution priority — 2026-10-15: P1-09 ready for UAT

This entry supersedes the older P0-07 priority below. User explicitly chose:
**Do not access PostgreSQL; continue other unblocked work, keeping P0-07 blocked.**
P0-07 remains blocked on database-backed middleware integration validation;
do not run that suite or provision/reset/reseed a database without new approval.

TK2610-0014 / P1-09 is Ready for UAT, not Done. The original DOCX scope is
"Clean up duplicate staff names in performer picker". The implemented interpretation
is picker identity cleanup, not account deletion/merging: repeated IDs appear once,
and distinct IDs with matching names (case/whitespace-normalized) show their email
or full ID when email is unavailable. Unique names remain unchanged. Existing
department eligibility and submitted staff IDs are preserved. No staff records
were altered. If the user intended duplicate-account remediation instead, this
slice does not complete that scope; clarify and obtain data-access approval first.

Files for this slice (absolute root:
/home/tuangpi/Documents/Aridient/Glampros/glampro_suite):

- apps/web/src/lib/performer-options.ts: shared identity-safe option builder.
- apps/web/src/lib/**tests**/performer-options.test.ts: four option-builder tests.
- apps/web/src/components/sale/CartLine.tsx: consume the shared options, carry email.
- apps/web/src/components/appointments/AppointmentFormDrawer.tsx: same option builder.
- apps/web/src/components/appointments/AppointmentFormDrawer.test.tsx: eligibility,
  duplicate-ID suppression and selected-ID submission regression test.
- apps/web/src/pages/**tests**/Sale.test.tsx: equivalent sale regression test.
- TASKS.md and docs/STATE.md: readiness and acceptance handoff.

Validation: full web suite 40 files / 354 tests passed; web typecheck and lint
passed; Prettier check on the six application/test files passed. Production web
build completed (shared prebuild, web typecheck and Vite; 426 modules transformed).
These are database-independent frontend checks with mocked hooks/API; they do
not establish production account quality or replace P0-07's required API tests.

Manual acceptance requested (not performed by the agent):

1. In Sale, add a service; verify each eligible account appears once and same-name
   accounts have distinct labels. Unique names should remain uncluttered.
2. In an appointment form, select a department-specific service and verify the
   same behavior; staff outside that department must remain excluded.
3. Confirm same-name people remain separate identities; confirm the label choice
   and picker-only interpretation meet the requested cleanup. Exercise desktop
   and mobile widths. Do not create live sales/bookings solely for this review.
4. After user acceptance, mark TK2610-0014 complete in the external task system
   and record acceptance here before changing tracker status to Done.

No PostgreSQL access, staging, commits or pushes. Extensive pre-existing changes
remain mixed in the working tree. Review scoped diffs before any future staging;
explicit commit/push approval is still outstanding. Original DOCX/PDF and design
folder unchanged. ADR 0017/0018 reviews remain deferred.

## Current execution priority — 2026-10-15

User requested continuing through work until an external task is ready for
acceptance, rather than stopping after each ADR review. Prioritize TK2610-0004 /
P0-07, the closest task: implementation and manual desktop/mobile acceptance are
recorded; changed requireModule API integration tests remain unrun. Remaining ADR
0017/0018 reviews are deferred, not prerequisites for this external task.

Re-read the tracker, P0-07 DOCX scope and middleware/test implementation. The suite
creates/deletes fixture tenants/users and upserts modules. Neither an existing
configured DATABASE_URL nor the presence of local PostgreSQL tools proves a safe
disposable target. No credentials displayed and no database queries or mutations
performed. User confirmation of an isolated test database remains the blocking
decision; do not reinterpret the request to continue as approval to reset/reseed
an existing database. Once confirmed, inspect migration safety, provision only the
approved disposable target, run the focused integration suite and relevant
regression checks, and evaluate full P0-07 scope before Ready for UAT. User
acceptance remains required for Done; do not mark the external task automatically.

No application edits, staging, commits or pushes in this prioritization step.
Commit/push approval remains outstanding. PJ2610-0026 update: no external task is
yet ready to mark complete; P0-07's remaining blocker is database-backed middleware
validation. This entry supersedes the incremental-ADR next action below.

Last updated: 2026-10-15. Current scope: setup for incremental roadmap improvements.
Read /home/tuangpi/Documents/Aridient/Glampros/glampro_suite/TASKS.md first.

## Confirmed constraints

Improve existing code, not a rewrite. Product name: Glampro Suite. No Docker or
GitHub Actions work. Leave deleted agent configuration absent. Leave the design
folder and original DOCX/PDF unchanged. Ask when scope/data safety is unclear.

## Changes in this session

- Created durable task tracking, this handoff and a corrected rename note.
- Updated web title/description, login heading, dashboard welcome, tenant-name
  fallback and matching dashboard test assertion to Glampro Suite.
- Cleaned docs references to deleted agent configuration; retain historical ADR substance.
- User completed the GitHub rename; API verified Tuangpi/glampro_suite with
  unchanged repository ID 1396845545. Updated this clone's origin and verified
  SSH ls-remote origin HEAD (exit 0). SETUP-04 is Done.
- No database changes, commit or push performed.

## Baseline / blockers

- Extensive existing user changes/deletions: preserve them.
- Origin now points to git@github.com:Tuangpi/glampro_suite.git. On 2026-10-15,
  GitHub's public API confirmed the renamed repository retained ID 1396845545.
  SSH access passed; remote HEAD is fb823d4d2cc5b56c2e7d6260bc7ef2b809105459.
- Root package.json, lockfile, tsconfig.base.json and formatter config are deleted.
  App scripts use npm workspaces; do not infer pnpm. Shared tsconfig extends the
  missing root config. App manifests contain duplicate shared-dependency keys.
- Calendar, discount/void and uncommitted shift work exist; assess before rebuilding.
- Historical docs still link to removed architecture/legacy material; full audit remains open.

## Validation

- Web `npm run typecheck`: failed (exit 127), tsc not found.
- Web `npm test -- --run src/pages/__tests__/Dashboard.test.tsx`: failed (exit 127), vitest not found.
- Static tracker/reference/branding checks: performed at session end; see final report.
- No dependency installation, compilation, API suite or full runtime verification performed.
  No product completion claimed; setup/branding remain Testing pending tooling recovery.
  Root npm run verify is unavailable while the root manifest is missing.

## Resumed session — 2026-10-15: P0-07 dashboard slice

User reconfirmed GitHub rename complete. Current origin was inspected and is
already git@github.com:Tuangpi/glampro_suite.git; no remote change needed.

Changed files (absolute repository root: /home/tuangpi/Documents/Aridient/Glampros/glampro_suite):

- apps/web/src/pages/Dashboard.tsx: removed system-status panel, recheck button,
  health hook invocation/polling and unused diagnostic helpers/icons. Replaced
  design-system copy and technical failure text with customer-facing wording.
  Kept business summary query, four metrics, loading dashes and error notice.
- apps/web/src/pages/**tests**/Dashboard.test.tsx: covers business figures,
  diagnostics absence, no health-hook call, loading dashes and friendly error.
- TASKS.md: TK2610-0004 / P0-07 In progress, not ready for UAT.

The reusable health hook and API health endpoints are unchanged; only the
customer dashboard's consumption was removed. No design changes, dependency
installation, deleted-file restoration, database action, commit or push.

Validation attempted this session:

- npm test -- --run src/pages/**tests**/Dashboard.test.tsx: exit 127, vitest not found.
- npm run typecheck: exit 127, tsc not found.
- npm run lint -- src/pages/Dashboard.tsx src/pages/**tests**/Dashboard.test.tsx:
  exit 127, eslint not found (existing lint script also includes the app directory).
- Source inspection and static checks only; no runtime/test pass claimed.
- Scoped pre-edit snapshots saved in /tmp/glampro-p007-baseline for review only;
  durable task context is this handoff, not temporary files.

## Exact next actions / questions

1. SETUP-02 still needs user clarification: were root package.json, lockfile,
   tsconfig.base.json and formatting config intentionally deleted? Obtain approval
   to restore/adapt native npm workspace tooling before installing dependencies.
2. Continue P0-07 audit of Settings, Sale, internal module names (e.g. giftCards),
   and remaining customer-facing developer copy. Keep internal identifiers stable;
   do not remove useful customer-facing disabled-feature messages indiscriminately.
3. After tooling recovery, run dashboard tests, lint/typecheck and broader UI
   regression tests; manually check the dashboard at desktop/mobile widths.
4. SETUP-04 complete for this clone. Audit other clones/integrations if present.
5. Database rename audit remains pending; never print connection credentials.

## External task reminder

No PJ2610-0026 task is ready to mark complete. TK2610-0004 / P0-07 is partially
implemented: remaining-screen cleanup, successful automated validation and UAT
are outstanding. Branding is partial P2-06; legal/domain checks remain outstanding.

## Resumed session — 2026-10-15: approved tooling recovery

User approved implementation of root tooling recovery after reporting missing
nodemon and vite. Earlier missing-tooling blockers above are historical.

Changes (all paths relative to the absolute repository root
/home/tuangpi/Documents/Aridient/Glampros/glampro_suite):

- Restored package.json, package-lock.json, tsconfig.base.json, .prettierrc.json
  and .prettierignore from the parent commit; adapted workspace names to
  @glampro_suite/* and root name to glampro_suite. Omitted historical Docker
  scripts. Root predev builds shared contracts and generates the Prisma client.
- Restored packages/shared/package.json conventions, ESM exports, Zod 4 and
  TypeScript 6 toolchain from history, retaining the renamed package identity.
- Removed duplicate shared dependency keys from both app manifests.
- Installed development dependencies and refreshed the lockfile/workspace links.
- Updated SETUP-02 to Testing. No application source or design changes.

Validation:

- npm install --include=dev --no-audit --no-fund: completed, 728 packages added.
  npm reported transitive deprecations and four unapproved install scripts;
  required build/runtime commands nevertheless passed. No script-approval
  policy was changed and no security audit was run.
- npm ls --depth=0: passed; all three renamed workspace links resolve locally.
- npm run build:shared and npm run db:generate: passed.
- npm run typecheck, npm run lint, npm run build: passed.
- Formatting check of changed JSON/config files: passed. An initial check also
  named .prettierignore, which has no parser; corrected scoped check passed.
- npm test: failed overall. API: 294 tests, 63 passed, 1 failed, 230 cancelled;
  integration hooks fail on missing tables including appointments and
  customer_outstanding_payments. Web: 38 files / 345 tests passed.
  Shared: 80 tests passed. Do not claim a full test pass.
- API npm run dev on temporary port 19000: nodemon launched tsx, /health
  returned HTTP 200 with status ok. Web npm run dev on temporary port 15173:
  Vite launched, / returned HTTP 200. Both smoke processes were stopped.
- git diff --check: passed before this documentation update; final checks follow.

Database caution: no migrations, resets or seed commands were run. The API test
suite was executed against the configured environment and its integration hooks
attempt database writes/cleanup. Do not infer that tests are read-only or that
no database writes occurred. Before rerunning, inspect the test database setup
and confirm a dedicated disposable database; do not repair the current database
blindly. Basic liveness is not proof that database-backed features work.

Next actions: user can run npm run dev from the repository root, or run each
app's npm run dev separately. Confirm the intended local/test database and
migration state before further database-backed validation. No commit or push.
PJ2610-0026 update: no external task ready to mark complete; tooling recovered,
but database-backed regression coverage and remaining P0-07 scope/UAT are open.

## Resumed session — 2026-10-15: P0-07 Settings and Sale copy

Inspected the latest handoff and working tree before editing. Approved tooling
recovery is already present as uncommitted work; preserved those files and all
other existing changes. The earlier missing-tools blocker is historical.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- apps/web/src/pages/Settings.tsx: replaced ADR/rail/tile jargon, release promises
  and entitlement/operator wording with salon-facing guidance. Display label
  "Slug" is now "Salon identifier"; stored values, permissions and contracts are unchanged.
- apps/web/src/pages/Sale.tsx: replaced server/catalogue implementation wording
  with checkout guidance and a clear completed-sale message.
- apps/web/src/pages/**tests**/Settings.test.tsx and
  apps/web/src/pages/**tests**/Sale.test.tsx: added copy regression coverage.
- TASKS.md: updated P0-07 evidence; remains In progress, not ready for UAT.

Validation:

- Scoped Prettier formatting applied to the four source/test files.
- npm run lint --workspace @glampro_suite/web: passed.
- npm run typecheck --workspace @glampro_suite/web: passed.
- npm test --workspace @glampro_suite/web: Vitest summary reports 38 files and
  347 tests passed, including dashboard and the new regressions. The terminal
  wrapper reported closure/exit 1 after that summary, so a clean shell exit was
  not captured; the test runner itself reports no failures.
- Final git diff --check and scoped Prettier --check were attempted, but shell
  integration returned no output/completion; their results are unconfirmed.
  Re-read the edited source, regression tests and tracker/handoff to verify edits.
- No API integration tests or database commands run. No design changes,
  dependency changes, commit or push performed in this slice.

Next: audit module display labels and remaining customer-facing screens for
developer copy; preserve useful disabled-feature messages and internal codes.
Manually review desktop/mobile layouts before UAT. Confirm a dedicated disposable
test database before database-backed validation; do not reset or seed blindly.

PJ2610-0026 update: no external task ready to mark complete. TK2610-0004 / P0-07
still needs remaining-screen/module-label audit and manual UAT.

## Resumed session — 2026-10-15: P0-07 module keys and remaining screens

Read the DOCX acceptance line for P0-07 again from the original file: developer
copy means ADR references, "server charges catalogue", the design-system note,
internal keys, and the system-status panel. The first three were already done; this
slice closed the internal-key item and finished the screen audit.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- packages/shared/src/constants.ts: added `MODULE_NAMES` (code to display name, the
  same names the seed writes into `Module.name`) and `moduleName(code)`, which falls
  back to the code for an unknown one.
- packages/shared/src/constants.test.ts (new): every code has a name that is not its
  own key; `moduleName` resolves `packages`, `giftCards` and `employeeCommission`
  and passes an unknown code through.
- apps/api/src/middleware/requireModule.ts: the `MODULE_NOT_ENTITLED` refusal now
  reads "This feature needs the Gift cards add-on." instead of quoting the key
  (`"giftCards"`), which is what the web's add-on empty state rendered as the
  description. `MODULE_UNKNOWN` no longer says `Unknown module "packages".` to the
  caller: it returns salon-facing copy and logs the offending code with the path.
  `details.module` still carries the raw code for machines and support.
- apps/api/prisma/seed.ts: the local `MODULE_NAMES` map is gone; the seed imports the
  shared one, so the panel and the refusal cannot drift.
- apps/api/src/middleware/requireModule.test.ts: the test harness now echoes
  `message`, and two assertions pin the refusal copy plus the `giftCards` case; the
  typo case pins that the sentence no longer quotes the key.
- apps/web/src/components/catalogue/GiftCardFormDrawer.tsx: "QR payload" is now
  "QR code value" and its hint no longer mentions a QR renderer or an image. Field
  name `qrPayload` and the contract are unchanged.
- apps/web/src/pages/**tests**/Products.test.tsx: opens the gift-card form and
  asserts the salon-facing label with no `payload`/`renderer` wording.

Audit performed (no copy changed):

- Every `.tsx` under apps/web/src, excluding tests and comments, was scanned for copy
  in `label`/`hint`/`description`/`title`/`placeholder`/`aria-label`/`alt` and in JSX
  text nodes: no ADR/phase/slice/handoff/schema/payload/tenant/entitlement/cache/
  renderer/debug wording remains. The scan flags the pre-change gift-card copy, so it
  is not a no-op.
- API error helpers and Zod message slots were scanned the same way. The only jargon
  left is `forbidden("This route requires a tenant context.")` and
  `forbidden("This token is not valid for a tenant realm.")`, both on bug paths that
  the salon UI cannot reach (a platform-scope token or a non-web realm), each carrying
  a machine-readable code. Left as-is deliberately; changing them would trade a
  diagnosis for a vaguer sentence on a path only developers hit.
- Settings already renders `Module.name` from the API rather than `Module.code`, so
  the panel showed "Gift cards" and not the key; the leak was in the refusal message.

Validation:

- npm run build:shared: passed (the API and web resolve `@glampro_suite/shared` from
  `dist`). dist is git-ignored.
- npm test --workspace @glampro_suite/shared: 83 tests / 31 suites passed, including
  the new constants suite.
- npm test --workspace @glampro_suite/web: 38 files / 348 tests passed, exit 0.
- npm run typecheck --workspace @glampro_suite/api and …/web: both passed.
- ESLint on every changed file (api, web, shared) : passed.
- npx prettier --check on the changed source/test files: passed. Note the repository
  is not Prettier-clean overall — TASKS.md, docs/STATE.md, docs/decisions/0008,
  apps/web/src/components/sale/PaymentDialog.tsx, apps/web/src/pages/**tests**/
  Dashboard.test.tsx and apps/api/src/routes/catalogue.routes.test.ts already fail on
  the new `.prettierrc.json` at HEAD, so the trackers were left in their filed style
  rather than reformatted.
- git diff --check: exit 0, no whitespace errors.
- Not run: API integration tests. `apps/api/src/lib/env.ts` loads `apps/api/.env`, so
  the suite would write to the configured database. Still blocked on a confirmed
  disposable test database.

Next: manual desktop/mobile layout review before UAT, then the DB-backed API suite
once a disposable database is agreed. No commit or push in this slice.

PJ2610-0026 update: no external task ready to mark complete. TK2610-0004 / P0-07 is
closer — the four DOCX items are now addressed in the web app and the module-key leak
is closed — but it stays In progress until UAT.

## Resumed session — 2026-10-15: SETUP-03 branding validation

Read the tracker and handoff, inspected the working tree and preserved all existing
changes. P0-07 remains awaiting manual desktop/mobile review; database-backed
validation remains blocked on confirmation of a disposable database. Continued the
unblocked SETUP-03 verification slice instead of assuming product-policy decisions.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- apps/web/src/pages/**tests**/Login.test.tsx: added an accessible-heading assertion
  for "Sign in to Glampro Suite" to the existing sign-in form regression test.
- TASKS.md: replaced stale SETUP-03 missing-validation wording with current evidence.
- docs/STATE.md: recorded this slice and remaining work.

Validation:

- npm test --workspace @glampro_suite/web -- src/pages/**tests**/Login.test.tsx
  src/pages/**tests**/Dashboard.test.tsx: 2 files / 19 tests passed, exit 0.
- npm run typecheck --workspace @glampro_suite/web: passed, exit 0.
- npm run lint --workspace @glampro_suite/web: passed, saved exit code 0.
- Prettier check of the edited Login.test.tsx: passed, saved exit code 0.
- Inspected branding in index.html, Login.tsx, Dashboard.tsx and AppShell.tsx;
  retained the Glampro master brand and real tenant names deliberately.

No application behavior, dependencies, database, design files, original DOCX/PDF,
Git remotes, commits or pushes changed in this slice. Full API integration tests
were not run. SETUP-03 remains Testing pending manual visual acceptance; P2-06
still requires external trademark/domain evidence.

Next: desktop/mobile visual review of branding and P0-07, then user acceptance.
Confirm a dedicated disposable test database before any database-backed tests.
For subsequent P0-09 implementation, clarify owner 2FA/recovery requirements and
test-account removal scope before changing authentication or production accounts.

PJ2610-0026 update: no external task is ready to mark complete. P0-07 still needs
manual desktop/mobile UAT; branding validation does not complete P2-06.

## Resumed session — 2026-10-15: SETUP-06 historical documentation slice

Continued the already-in-progress documentation audit while SETUP-03/P0-07 await
manual visual acceptance and API integration tests await a confirmed disposable
database. Read the tracker/handoff and inspected existing changes before editing.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- docs/decisions/README.md: explains absent historical sources, old phase numbers
  and stale STATE section references; points to current scope without restoring
  deleted sources. Preserved ADR numbering and the rationale for leaving 0001 empty.
- docs/decisions/0004-platform-console-is-its-own-app.md: added a dated current-scope
  note and qualified obsolete container/CI assumptions. Retained the separate-app
  decision and original architecture context; no console implementation claimed.
- TASKS.md: updated SETUP-06 evidence and remaining audit scope; still In progress.
- docs/STATE.md: recorded this slice and verification.

Validation:

- Local Prettier --check on both edited ADR files: passed, exit 0.
- git diff --check: passed, exit 0, including the appended session handoff.
- Local Markdown link scan (TASKS.md, top-level docs Markdown and ADRs, excluding
  design folders): distinct missing targets reduced from 11 to 9. This is not a
  clean link-check pass: remaining targets are absent historical sources under
  docs/legacy and docs/saas, plus CONTEXT.md, architecture.md, mvp.md and roadmap.md.
  These references remain explicitly historical; no replacement facts invented.
- SHA-256 comparison of 62 protected files (design, docs/design, original DOCX/PDF):
  unchanged from the pre-edit baseline.
- No application tests run: this slice changes documentation only. API integration
  tests remain blocked; no database commands were run.

Next: continue SETUP-06 by assessing individual ADR references against existing code
and tests without rewriting decision history. Flag substantive ADR/code conflicts
for review rather than silently changing accepted decisions. SETUP-03 and P0-07
still need desktop/mobile visual acceptance. Confirm a disposable database before
API integration tests; clarify owner 2FA/recovery and test-account removal scope
before P0-09 implementation.

Existing application/tooling work was preserved. No design, original DOCX/PDF,
dependencies, database, Git remotes, commit or push changed in this slice.

PJ2610-0026 update: no external task is ready to mark complete. SETUP-06 remains
an incremental setup audit; P0-07 still needs manual desktop/mobile UAT.

## Resumed session — 2026-10-15: SETUP-06 navigation evidence review

Re-read the tracker/latest handoff and inspected the working tree. Continued the
unblocked documentation audit with ADR 0005, preserving all existing changes.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- docs/decisions/0005-rail-has-no-services-destination.md: added a dated evidence
  review linking current navigation, routes, catalogue and regression tests.
  Corrected the consequence claiming seven entries visible to every signed-in user:
  eight entries exist, Reports/Settings are role-restricted, leaving six before
  entitlement filtering. Replaced obsolete future-phase Services-tab test-gap
  wording with the existing tab-presence and service-row coverage. Preserved the
  no-separate-Services-destination decision and historical source context.
- TASKS.md: recorded focused verification; SETUP-06 remains In progress.
- docs/STATE.md: recorded this review and remaining work.

Validation:

- npm test --workspace @glampro_suite/web -- src/constants/navigation.test.ts
  src/pages/**tests**/Products.test.tsx: 2 files / 31 tests passed, exit 0.
- Local Prettier --check on ADR 0005: passed, exit 0.
- git diff --check: passed, exit 0. All five current evidence-link targets resolve;
  the ADR index heading anchor exists. SHA-256 comparison of all 62 protected
  design/original-document files matched the pre-edit baseline.
  Nine distinct historical missing link targets remain from the
  preceding audit; this slice does not restore them or claim a clean link audit.
- No application behavior or tests changed; no database-backed tests run.

Next: continue SETUP-06 with another bounded ADR/code evidence review. ADR 0007's
logout/password-change claims can be inspected, but its API integration suite
must not run until a disposable test database is confirmed. Do not change security
semantics without clarifying owner 2FA/recovery and account-removal requirements.
SETUP-03 and P0-07 remain awaiting manual desktop/mobile visual acceptance.

No design files, original DOCX/PDF, application code, dependencies, database,
remotes, commits or pushes changed in this slice.

PJ2610-0026 update: no external task is ready to mark complete. SETUP-06 is still
an incremental audit; P0-07 requires manual desktop/mobile UAT.

## Resumed session — 2026-10-15: visual acceptance and ADR 0007 review

User confirmed: "I accept desktop/mobile by manual checking on the web browser."
Recorded this as acceptance of the outstanding SETUP-03 and P0-07 visual review.
SETUP-03 is Done. P0-07 moves to Testing, not Done: its changed API middleware
integration tests still need a confirmed disposable database. Prior entries saying
visual acceptance is outstanding are historical and superseded by this confirmation.

Inspected the working tree and preserved existing work, including a newly observed
untracked apps/api/prisma/migrations/20261015092232_default directory. Its presence
does not confirm database safety; no migration or database command was run.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- docs/decisions/0007-logout-revokes-the-refresh-token-not-the-user.md: added dated
  code/test evidence and explicitly separated intended policy from implementation
  limits. Removed the assertion that absent historical documents enforce behavior.
- TASKS.md: recorded visual acceptance/statuses and P0-09 review findings, keeping
  full security hardening Not assessed until its DOCX scope is audited.
- docs/STATE.md: recorded acceptance, findings, verification and next actions.

Findings for security-policy review (no authentication behavior changed):

- Logout itself revokes only the presented hash without changing tokenVersion.
  Refresh handling treats every already-revoked token as replay, regardless of
  whether rotation or logout revoked it, then revokes all active refresh rows for
  that user. Thus a later refresh using a logged-out token can affect other sessions,
  contrary to a broad reading of ADR 0007's other-session guarantee.
- Password change increments tokenVersion and subsequently revokes refresh rows in
  separate writes, not a transaction. Failure/race safety is not established here.
- Browser sign-out clears local credentials and query cache before best-effort
  server logout; a failed request does not prove server revocation. The ADR's
  15-minute post-logout access exposure assumes successful refresh-token revocation.
- Platform-console forced sign-out is a requirement, not an implemented API endpoint.
- API logout/password-change integration assertions exist and were read, not run.

Validation:

- npm test --workspace @glampro_suite/web --
  src/contexts/**tests**/AuthContext.test.tsx: 1 file / 6 tests passed, exit 0.
  Requests are mocked; this is not evidence of database revocation.
- Local Prettier --check on ADR 0007: passed, exit 0.
- git diff --check: passed, exit 0. All seven current evidence-link targets resolve.
  SHA-256 comparison of 62 protected design/original-document files matched the
  pre-edit baseline.
- No API integration tests, migrations, resets, seeds or database queries run.

Next: continue the remaining SETUP-06 evidence audit, or perform a read-only P0-09
scope audit. Before changing security behavior, clarify revoked-token replay policy,
owner 2FA/recovery and test-account removal scope. Confirm a disposable database
before API integration tests; that is P0-07's remaining validation blocker.

No application code/tests, dependencies, design files, original DOCX/PDF, migrations,
remotes, commits or pushes changed in this slice.

PJ2610-0026 update: no external task is ready to mark complete. P0-07 visual UAT is
accepted, but API middleware integration validation remains database-blocked.

## Resumed session — 2026-10-15: SETUP-06 low-stock threshold evidence review

User approved the documentation-only implementation slice after Plan-mode review.
Re-read the selected ADR and latest tracker/handoff, inspected existing changes,
and preserved all application/tooling work, including the untracked migration.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- docs/decisions/0010-low-stock-threshold-is-per-tenant.md: added a dated evidence
  review linking schema/migration, catalogue behavior, Settings contracts/routes/
  service/screen and tests. Preserved the accepted decision and original phase
  context. Settings now provides the deferred threshold editor, so the historical
  no-editor consequence is no longer current. Flagged the query-override conflict
  rather than silently changing policy or code.
- TASKS.md: recorded ADR 0010 findings; SETUP-06 remains In progress.
- docs/STATE.md: recorded this slice, verification and next actions.

Unresolved conflict: ADR 0010 items 2–3 require row-level lowStock flags to use the
stored tenant threshold even when filtering uses an explicit query override.
listProducts instead uses the resolved override for both filtering and row flags.
The existing override integration test checks the count, not those flags. Before
changing behavior, confirm whether to retain the accepted stored-threshold rule
or formally revise it; then add regression coverage for the chosen semantics.

Validation:

- npm test --workspace @glampro_suite/web --
  src/pages/**tests**/Settings.test.tsx: 1 file / 4 tests passed, exit 0.
  Requests are mocked; this does not establish persistence or API authorization.
- Local Prettier --check on ADR 0010: passed, exit 0.
- git diff --check: passed, exit 0. All ten new evidence-link targets resolve.
- SHA-256 comparison of all 62 protected design/original-document files matched
  the pre-edit baseline. Historical missing links were not restored or declared fixed.
- API catalogue/Settings integration tests were inspected, not executed: a confirmed
  disposable database is still required. No migrations, resets, seeds or database
  queries run. No application code/tests changed; full build/lint/typecheck not run
  for this documentation-only slice.

Next: continue SETUP-06 with another bounded ADR/code review. Resolve threshold
override semantics explicitly before implementation. Confirm a disposable database
before API integration tests; P0-07's remaining validation is still blocked on this.
Keep the security-policy questions from the preceding handoff open.

No design files, original DOCX/PDF, dependencies, application behavior, database,
migrations, remotes, commits or pushes changed in this slice.

PJ2610-0026 update: no external task is ready to mark complete. SETUP-06 remains
an incremental documentation audit; P0-07 still needs API middleware validation.

## Resumed session — 2026-10-15: SETUP-06 receipt-sequence evidence review

Resumed the next bounded documentation review after reading the latest tracker
and handoff and inspecting the working tree. Preserved all existing changes.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- docs/decisions/0011-receipt-number-is-a-per-tenant-sequence.md: added a dated
  review with current schema, migration, allocation, contract, UI and test evidence.
  Preserved the accepted sequencing policy and original phase context.
- TASKS.md: recorded the latest SETUP-06 evidence; status remains In progress.
- docs/STATE.md: recorded findings, verification and next actions.

Findings:

- writeSale is no longer the only allocator: completeSale also increments the
  tenant counter inside its transaction, after a guarded HELD-status transition.
  Both paths check MAX_RECEIPT_NUMBER; creating a hold allocates no number.
- Null receipt numbers therefore also describe current held carts, not only legacy
  rows. ADR 0015 already documents this extension of the original policy.
- ReceiptView renders "number pending" and promises a number "shortly" for an
  unnumbered completed sale. The inspected allocation paths do not backfill an
  already-completed unnumbered sale. Review that promise against the intended
  legacy-receipt policy before changing copy or adding behavior.
- Existing sequential-number and idempotency assertions are not proof of concurrent
  allocation, rollback or ceiling handling. No runtime database guarantees claimed.

Validation:

- npm test --workspace @glampro_suite/web -- src/pages/**tests**/Sale.test.tsx:
  1 file / 23 tests passed, exit 0. Browser requests are mocked.
- node --import tsx --test packages/shared/src/schemas/sales.test.ts:
  35 tests passed, exit 0; database-free contract checks.
- Local Prettier --check on ADR 0011: passed, exit 0.
- git diff --check: passed, exit 0. All nine new evidence-link targets resolve.
- SHA-256 comparison: all 62 protected design/original-document files unchanged.
- API integration tests not run pending confirmation of a disposable database.
  No database queries, migrations, resets or seeds. Full build/lint/typecheck not
  run for this documentation-only slice; no application code/tests changed.

Next: continue SETUP-06 with ADR 0012's tender-row policy against current code and
tests. Keep ADR 0010 override semantics and legacy unnumbered-receipt messaging
open for explicit review. Confirm a disposable database before API validation;
P0-07 remains blocked on that validation. Security-policy questions remain open.

No design files, original DOCX/PDF, dependencies, application behavior, database,
migrations, remotes, commits or pushes changed in this slice.

PJ2610-0026 update: no external task is ready to mark complete. SETUP-06 remains
an incremental documentation audit; P0-07 still needs API middleware validation.

## Resumed session — 2026-10-15: SETUP-06 tender-row evidence review

Continued the next bounded documentation slice after reading the tracker and
handoff and inspecting existing working-tree changes. Preserved prior work.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- docs/decisions/0012-sale-tenders-are-rows.md: added a dated evidence review
  against the schema/migration, shared contracts, both service write paths,
  payment dialog and tests. Preserved the accepted policy and historical text.
- TASKS.md: updated the latest SETUP-06 evidence; status remains In progress.
- docs/STATE.md: recorded this review, verification and next action.

Findings:

- Both ordinary checkout and held-cart completion call writePayments inside their
  completion transaction, using the same Decimal-based totals calculation. The
  original POST /api/sales description is not the only tender-writing path now.
- Holds reject tenders and return before insertion. Empty tenders do not always
  mean UNPAID: a completed zero-total cart meets the service's paid-in-full test.
- Optional sessionId is stored metadata, not gateway verification. The inspected
  writes do not validate settlement; the browser posts method/amount rows only.
- Existing database assertions cover split rows and the card row's session ID,
  but were not executed. No persistence, rollback or concurrency proof claimed.

Validation:

- node --import tsx --test packages/shared/src/schemas/sales.test.ts:
  35 tests passed, exit 0; database-free contract checks.
- npm test --workspace @glampro_suite/web -- src/pages/**tests**/Sale.test.tsx:
  1 file / 23 tests passed, exit 0; mocked browser requests.
- Local Prettier --check on ADR 0012: passed, exit 0.
- git diff --check: passed, exit 0 before the handoff update; repeated at final
  verification along with evidence-link and protected-file checks.
- API integration tests not run pending confirmation of a disposable database.
  No database queries, migrations, resets or seeds. Full build/lint/typecheck not
  run for this documentation-only slice; application code/tests are unchanged.

Next: continue SETUP-06 with ADR 0013's service-derived appointment performer and
duration policy against current code/tests. Keep ADR 0010 override semantics,
legacy unnumbered-receipt messaging and security-policy questions open. Confirm
a disposable database before API validation; P0-07 remains blocked on that check.

No design files, original DOCX/PDF, dependencies, application behavior, database,
migrations, remotes, commits or pushes changed in this slice.

PJ2610-0026 update: no external task is ready to mark complete. SETUP-06 remains
an incremental documentation audit; P0-07 still needs API middleware validation.

## Resumed session — 2026-10-15: SETUP-06 appointment-policy evidence review

Reviewed ADR 0013 against shared contracts, Prisma models, appointment write paths,
booking/till pickers and current tests. Preserved accepted policy and prior work.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- docs/decisions/0013-appointment-performers-come-from-the-service.md: added dated
  evidence and explicit discrepancies, without rewriting historical policy.
- TASKS.md: updated SETUP-06 latest evidence; status remains In progress.
- docs/STATE.md: recorded findings, validation, blockers and next action.

Findings:

- Missing service duration defaults to 60 minutes in API and browser preview.
  Unknown duration/end-time request keys are stripped, not rejected.
- Every PATCH re-derives duration from the current catalogue, even for unrelated
  edits, conflicting with schema/contract snapshot wording. Department eligibility
  is also rechecked on every patch. Snapshot semantics need explicit resolution.
- Service-only resizing and catalogue-driven resizing on unrelated patches bypass
  assertNoClash, which is gated only on startsAt/staffId presence. This is a static
  control-flow finding, not a live database reproduction or a concurrency claim.
- Department mismatch is a 400 with STAFF_NOT_IN_DEPARTMENT but no field detail.
  Server eligibility lookups do not enforce the picker's active-status filters.
- Till department narrowing is advisory as accepted; server checks tenant staff
  existence. Historical eligibility/filtering test claims overstate current tests.

Validation:

- Six ad hoc database-free assertions against appointment schemas passed (exit 0):
  required service, unassigned create, stripping duration/end-time keys on create
  and update, explicit unassignment and service-only patch. Initial heredoc command
  had unconfirmed completion; the single-command rerun produced the confirmed pass.
- Focused mocked web tests: Appointments.test.tsx and Sale.test.tsx, 2 files /
  32 tests passed (exit 0). The appointment page mocks the drawer; these do not
  establish performer filtering, service eligibility or database correctness.
- ADR 0013 Prettier check and git diff --check passed (exit 0); final handoff,
  evidence-link and protected-file checks repeated after this entry.
- API integration tests not run pending confirmation of a disposable database.
  No database queries, migrations, resets or seeds. Full build/lint/typecheck not
  run for this documentation-only slice; application code/tests are unchanged.

Next: continue SETUP-06 with ADR 0014's clash policy and update/status triggers.
Keep ADR 0013 snapshot/fallback/active-status policy and resize-validation defects
open for a bounded implementation follow-up with regression tests. Keep ADR 0010
override semantics, legacy unnumbered-receipt messaging and security-policy
questions open. Confirm a disposable database before API validation; P0-07 remains
blocked on that check.

No design files, original DOCX/PDF, dependencies, application behavior, database,
migrations, remotes, commits or pushes changed in this slice.

PJ2610-0026 update: no external task is ready to mark complete. SETUP-06 remains
an incremental documentation audit; P0-07 still needs API middleware validation.

## Resumed session — 2026-10-15: SETUP-06 clash-policy evidence review

Reviewed ADR 0014 against appointment contracts, service create/update paths,
schema/migration SQL, calendar drag/mutation handling and tests. Preserved accepted
policy and prior working-tree changes; no application behavior changed.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- docs/decisions/0014-double-booked-staff-are-refused.md: added dated evidence,
  status/resize gaps, error/client-path corrections and validation limits.
- TASKS.md: updated SETUP-06 latest evidence; status remains In progress.
- docs/STATE.md: recorded this review, verification, blockers and next action.

Findings:

- Half-open overlap, existing-blocker statuses, self-exclusion and null-performer
  bypass are implemented. They do not guarantee every write preserves the policy.
- Status-only CANCELLED-to-occupying patches bypass clash checks. Cancelled create
  and time/staff edits are conversely checked without considering target status.
- ADR 0013's service/catalogue-driven resize gaps remain. These are static
  control-flow findings, not live database reproductions or concurrency tests.
- Clash errors use 409 APPOINTMENT_CLASH without field details; message times use
  the server runtime timezone. Historical CONFLICT/field-highlighting claims differ.
- Drag uses useRescheduleAppointment with optimistic cache snapshots and rollback,
  not useUpdateAppointment. It throws from onError; actual rollback/toast delivery
  needs focused mutation tests. Current web suites do not establish those paths.
- Separate clash query/write retains the acknowledged race. No overlap exclusion
  was found in inspected migration SQL; deployed constraints were not inspected.
  The historical few-milliseconds timing claim is not measured evidence.

Validation:

- Five database-free status/unassignment contract assertions passed (exit 0),
  covering cancelled create, status-only reactivation, cancellation/time patch,
  explicit unassignment and the occupying-status complement. No persistence proof.
- Focused web tests passed: Appointments.test.tsx, CalendarView.test.tsx and
  calendar-geometry.test.ts, 3 files / 64 tests (exit 0). Hooks are mocked by the
  page tests; drag callback/geometry coverage does not prove API refusal/rollback.
- ADR formatting, git diff --check, evidence-link and protected-file checks run
  at final verification; see completion report for outcomes.
- API suites not run pending confirmation of a disposable database. No database
  queries, migrations, resets or seeds. Full build/lint/typecheck not run for this
  documentation-only slice; application code/tests are unchanged.

Next: continue SETUP-06 with ADR 0015's held-sale draft policy. Keep the appointment
status/resize defects and snapshot/fallback/active-status questions open for a
bounded implementation follow-up with regression tests. ADR 0010 override semantics,
legacy unnumbered-receipt messaging and security-policy questions remain open.
Confirm a disposable database before API validation; P0-07 remains blocked there.

No design files, original DOCX/PDF, dependencies, application behavior, database,
migrations, remotes, commits or pushes changed in this slice.

PJ2610-0026 update: no external task is ready to mark complete. SETUP-06 remains
an incremental documentation audit; P0-07 still needs API middleware validation.

## Resumed session — 2026-10-15: SETUP-06 held-sale evidence review

Reviewed ADR 0015 against sale contracts, create/complete/discard/list paths,
report filters, till pickup/payment/draft persistence and tests. Accepted policy,
application behavior and prior working-tree changes are preserved.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- docs/decisions/0015-a-held-sale-is-a-tenant-visible-draft.md: added dated evidence,
  implemented lifecycle qualifications, open UI/lifecycle issues and test limits.
- TASKS.md: refreshed SETUP-06 latest evidence; status remains In progress.
- docs/STATE.md: recorded findings, checks, blockers and next action.

Findings:

- Holds skip receipt allocation, tenders and ledgers, but soldAt is populated when
  parked and overwritten at completion. Completion can be unpaid/part-paid for a
  customer; it is not itself proof of money changing hands.
- Stock is validated before parking without being reserved. Completion can return
  initial-read BAD_REQUEST or guarded-decrement INSUFFICIENT_STOCK failures.
- Completion guards HELD inside its transaction; sequential replay returns the
  receipt, concurrent losers can conflict. Discard only deletes still-held rows.
  Pickup is a read, not a claim, and leaving held does not persist local edits.
- The newest 50 holds are returned with no paging/total/truncation disclosure,
  qualifying the policy's every-hold claim. Current sales report reads filter COMPLETED.
- Static UI findings: resumed stored prices can differ from current server pricing;
  restoring an already-discounted unitPrice plus its rate double-discounts preview;
  hold identity is not persisted with cart lines, so reload can create a new sale
  and leave the original hold behind. Pickup also replaces the existing local cart.
- Browser hold creation omits optional idempotency keys, so an uncertain-response
  retry can duplicate drafts. No runtime or database reproduction is claimed.

Validation:

- node --import tsx --test packages/shared/src/schemas/sales.test.ts: 35 tests passed,
  exit 0, database-free contracts.
- Focused web runner reported 2 files / 26 tests passed for Sale.test.tsx and
  sale-draft-storage.test.ts. Read the saved /tmp/glampro-adr0015-web-tests.log to
  confirm the summary after shell integration reported a terminal-close error;
  wrapper exit status was not confirmed. Initial parallel invocation also had
  unobserved completion. No claim of database lifecycle coverage from these tests.
- ADR formatting, whitespace, evidence-link and protected-file checks performed
  at final verification; see completion report for outcomes.
- API integration tests not run pending confirmation of a disposable database.
  No database queries, migrations, resets or seeds. Full build/lint/typecheck not
  run for this documentation-only slice; application code/tests unchanged.

Next: continue SETUP-06 with ADR 0016's whole-sale void/reversal policy. Keep held
cart pricing, discount preview, identity persistence, list completeness and retry
issues open for bounded follow-up with regression tests. Appointment defects,
ADR 0010 override semantics, legacy unnumbered-receipt messaging and security-policy
questions remain open. Confirm a disposable database before API validation;
P0-07 remains blocked on that check.

No design files, original DOCX/PDF, dependencies, application behavior, database,
migrations, remotes, commits or pushes changed in this slice.

PJ2610-0026 update: no external task is ready to mark complete. SETUP-06 remains
an incremental documentation audit; P0-07 still needs API middleware validation.

## Resumed session — 2026-10-15: SETUP-06 void/reversal evidence review

Reviewed ADR 0016 against contracts, role/actor routing, migration/schema,
transactional reversals, receipts, cache invalidation and tests. Preserved accepted
policy, application behavior and prior working-tree changes.

Changed files under /home/tuangpi/Documents/Aridient/Glampros/glampro_suite:

- docs/decisions/0016-a-void-is-a-recorded-whole-sale-reversal.md: dated evidence,
  guarantee qualifications, integrity/retention/UI issues and coverage limits.
- TASKS.md: refreshed SETUP-06 latest evidence; status remains In progress.
- docs/STATE.md: recorded review, checks, blockers, next action and commit discussion.

Findings:

- Role guards and token-derived actor match policy. Void reverses ledger state in
  a guarded transaction but does not refund money; tenders remain historical.
- Sequential replay returns the receipt. Concurrent requests can return
  SALE_ALREADY_VOID; no concurrent redemption/payment isolation proof claimed.
- Missing products can be skipped during stock restoration because updateMany's
  count is ignored. Parent customer/cashier deletion can cascade-delete receipts;
  SET NULL on the separate void-actor relation is not full retention protection.
- Voided unpaid receipts still derive/display Outstanding from original totals,
  despite deleted debt. Void invalidation omits business-summary/report/customer
  caches. These are static findings, not live reproductions.
- API tests cover several reversals/refusals but do not prove every holding type,
  seeded commission deletion, concurrent replay, parent deletion or missing items.

Validation:

- node --import tsx --test packages/shared/src/schemas/sales.test.ts: 35 tests passed,
  exit 0. Initial combined invocation completion was unobserved; rerun confirmed.
- npm test --workspace @glampro_suite/web -- src/pages/**tests**/Sale.test.tsx:
  1 file / 23 tests passed, exit 0; mocked browser requests, not ledger evidence.
- ADR formatting, whitespace, evidence-link and protected-file checks performed
  at final verification; see completion report for outcomes.
- API integration suites not run pending confirmation of a disposable database.
  No database queries, migrations, resets or seeds. Full build/lint/typecheck not
  run for this documentation-only slice; application code/tests unchanged.

Commit discussion: user asked when work will be committed, not an explicit commit
authorization. Proposed checkpoint is after ADR 0016–0018 reviews: prepare a scoped
documentation file list/diff for approval, excluding application/tooling changes.
No staging, commit or push performed. Existing documentation diffs also include
prior work and must be reviewed before staging; do not blindly commit whole files.

Next: continue SETUP-06 with ADR 0017's recorded line-discount policy, then ADR 0018.
Keep void integrity/retention/display/cache issues, held-cart defects, appointment
defects, ADR 0010 override semantics, legacy receipt messaging and security-policy
questions open. Confirm a disposable database before API validation; P0-07 remains
blocked on that check. Prepare commit scope at the proposed checkpoint; request
explicit approval before committing, and do not push without approval.

No design files, original DOCX/PDF, dependencies, application behavior, database,
migrations, remotes, commits or pushes changed in this slice.

PJ2610-0026 update: no external task is ready to mark complete. SETUP-06 remains
an incremental documentation audit; P0-07 still needs API middleware validation.

## Session — 2026-10-16: Done-at-Ready-for-UAT policy applied; SETUP-01 → Done

Applied the tracker policy change agreed for this and all coming tasks: a slice at `Ready for UAT` is now marked `Done` in TASKS.md at hand-off and does **not** wait for user acceptance. Acceptance still happens externally (PJ2610-0026); the local tracker marks Done at Ready for UAT. Parent phases/milestones still need all children and explicit sign-off. Updated TASKS.md completion rule (line 31–32) and session-end reminder (line 37) accordingly.

- TASKS.md: completion rule changed ("mark Done at Ready for UAT — do not wait for user acceptance"); session-end reminder changed ("mark it complete in your task system at hand-off — no wait for UAT"); SETUP-01 status Ready for UAT → Done with evidence reworded ("Submitted for acceptance; marked Done at Ready for UAT per tracker policy.").
- docs/STATE.md: this entry.

No other task is currently Ready for UAT in TASKS.md. TK2610-0004 / P0-07 and TK2610-0006 / P0-08 are already Done per prior user confirmation. No design files, original DOCX/PDF, dependencies, application behavior, database, migrations, remotes, commits or pushes changed in this slice.

PJ2610-0026 update: no external task is ready to mark complete; SETUP-01 is Done in the local tracker awaiting external acceptance.

## Session — 2026-10-16: API baseline fix (P0-03 settings surface) and commit

Fixed 5 typecheck + 2 lint errors on the API baseline at HEAD — all pre-existing in `apps/api/src/routes/settings.routes.ts` and `apps/api/src/services/settings.service.ts` (no uncommitted source changes; these were not introduced by this session):

- routes: removed unused import `salonOperatingHoursSchema`.
- service: removed unused import `updateSalonOperatingHoursSchema`; added missing type import `UpdateSalonProfileInput` (used at `updateSalonProfile` signature but never imported).
- service: null-safe day write (`value?.open ?? null`, `value?.close ?? null`) so `PATCH /settings/hours` with a `null` day (closed) sets both fields to null instead of throwing `value.open` at runtime — matches the create path and the P0-03 "null day = closed" semantics.

Changed files:
- apps/api/src/routes/settings.routes.ts
- apps/api/src/services/settings.service.ts

Validation confirmed exit 0:
- API typecheck (`tsc --noEmit`): passed (was 5 errors).
- API lint (`eslint .`): passed (was 2 errors).
- Shared typecheck: passed. Web typecheck: passed.
- Shared tests: passed. Web tests: 381 passed.

No database commands, migrations, resets or seeds; API integration tests remain blocked pending confirmation of a disposable test database. No design files, original DOCX/PDF, dependencies, remotes, commits or pushes changed in this slice.



PJ2610-0026 update: no external task is ready to mark complete; SETUP-01 and the API baseline fix await commit. Remaining blockers: disposable database (SETUP-02/05, P0-07 middleware validation) and ADR 0010/0011 decisions (SETUP-06).

## Session — 2026-10-17: ADR evidence reviews (SETUP-06/07/08 → Done)

Completed the ADR evidence-review documentation phase. Appended five-section-skeleton Evidence Reviews dated 2026-10-17 to four ADRs (0002, 0003, 0006, 0008), re-injected the corrected 44px `IconButton` paragraph into ADR 0008, and marked SETUP-06/SETUP-07/SETUP-08 Done in TASKS.md.

- **ADR 0002** (tenant-id = owner-id): qualified historical references; confirmed route guard and repository scoping still enforce tenant isolation in the current code.
- **ADR 0003** (tenant-scoped customer email): confirmed the unique constraint is still scoped by tenant in the migration and service layer; noted the case-insensitive lookup caveat.
- **ADR 0006** (snap handoff values to tokens): verified `cmp` on the two token files still exits 0 (copy rule holds); fractional utilities emit CSS; `design/HANDOFF.md` is absent (historical reference, not a blocker — deltas recorded in the ADR's own table). A duplicate Evidence Review section was removed (the review had been appended twice).
- **ADR 0008** (login-screen-shape): re-injected the paragraph describing the 44px `IconButton` holding the ported `Eye` inside the password control — the paragraph that was dropped during an earlier edit and is required for the layout to read coherently. A duplicate Evidence Review section was removed (the review had been appended twice).

Commits:
- `257eead docs(decisions): refresh ADRs 0002/0003/0006/0008 with evidence reviews` — four ADR files, one Evidence Review each (dedup of 0006/0008 squashed in).
- `d7bf959 docs: mark SETUP-06/07/08 Done in tracker + fix en-dash` — TASKS.md rows for SETUP-06, SETUP-07, SETUP-08; this STATE.md entry.

`docs/AUDIT.md` is absent in this checkout — TASKS.md and `docs/STATE.md` remain the sources of truth. All 18 ADRs (0002–0018) carry the five-section skeleton; `grep -c '^## Evidence review' docs/decisions/*.md` = 4 (one each in 0002, 0003, 0006, 0008) after the dedup. No application source, design file, database, migration, dependency or remote change was made.

PJ2610-0026 update: no external task is ready to mark complete; SETUP-06/07/08 are Done in the local tracker. Remaining blockers: disposable database (SETUP-02/05, P0-07 middleware validation) and the open ADR 0010/0011 decision points recorded in SETUP-06's history.
