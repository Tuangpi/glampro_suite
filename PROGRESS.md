# Glampro Suite — progress

## Current State

- Current task: **TK2610-0025 — aesthetics/spa module (IN PROGRESS)**. Latest completed slice: **consent integrity/contracts with isolated HTTP/database acceptance**. Consent profile UI and retention/permissions/repeat-decision policy remain unfinished. Prior treatment-link migration/browser/privacy acceptance is user-reported. TK2610-0027 remains IN PROGRESS.
- P2 phase TK2610-0003: IN PROGRESS; previous completion/sign-off claims withdrawn. TK2610-0026: BLOCKED pending official vendor-route verification, business evidence and submission.
- SEC-01 complete: real-DB/local SMTP automated checks passed and user explicitly accepted manual browser testing October 22, 2026. Acceptance is user-reported, not an agent walkthrough. Production SMTP/account audit remains unverified. Existing application accounts/passwords unchanged.
- Resources: approved disposable PostgreSQL cluster (loopback 55439, sec01_acceptance) migrated and tested; fixture removed, SMTP capture closed and cluster stopped. No application/production database or external mail used.
- Standing instruction: user grants manual acceptance on completion of implementation and available automated verification; do not request another manual UAT/review round. This is not agent-executed testing or completion of unperformed operational actions.
- Next: integrate consent forms/events into customer profiles under TK2610-0025; resolve retention, role permissions and repeat/withdrawal policy before changing those behaviors. Family sharing/transfer/audit remain separate TK2610-0027 gaps. Neither parent is ready to close. No production access or paid mail authorized.

## October 22, 2026 — Consent integrity/contracts completed

- TK2610-0025 stays IN PROGRESS; this completes only the backend/contracts slice
  selected after the audit. TK2610-0027 stays IN PROGRESS. Neither external ID is
  ready for closure. Existing uncommitted photo changes were preserved.
- Fixed active-form parameter schema and shared list-filter validation (including
  repeated/invalid filter refusal). Event requests no longer require/trust a client
  witness; JWT remains authoritative, and the URL owns the treatment ID. Non-null
  signature submissions now return validation errors rather than silently losing
  data. Signature capture is still not implemented; null remains compatible.
- Event creation checks tenant-scoped customer/record/form existence, matching
  customer and treatment type, and active-form eligibility within a transaction.
  Treatment and form row locks serialize clinical edits/publication against consent
  creation. Duplicate decisions return CONSENT_EVENT_EXISTS, including concurrent
  requests; existing one-decision-per-treatment/form policy is unchanged.
- Form version allocation, deactivation and insertion are atomic. A tenant-row
  FOR NO KEY UPDATE lock serializes publishers even for the first version without
  blocking tenant foreign-key checks during concurrent consent insertion. This is
  intentionally coarse per tenant; no new dependency or migration. Failed insertion
  rolls back deactivation. Version numbers remain server-assigned.
- Treatment detail and event responses preserve original form text/version with
  serialized timestamps; history has stable date/id ordering. Missing/foreign
  parent history returns 404. Form hooks now separate type/active filter caches.
- Added dedicated treatment-consent acceptance, shared schema and hook cache tests.
  Passed fresh: isolated PostgreSQL consent HTTP/service acceptance 1/1 and existing
  session/photo acceptance 1/1 (none skipped); full shared 146/146; full web 507/507;
  full production build, API typecheck and root lint. Final format/diff checks at
  handoff. Acceptance covers same/cross-tenant refusals, grants/declines, witness and
  URL spoofing, unsupported signatures, auth/entitlement/suspended-write boundaries,
  original evidence, concurrent first/later publication, duplicate decisions,
  publication-versus-recording and failed-publication rollback.
- Reused only approved disposable loopback 55440/package_expiry_test. Both acceptance
  fixtures cleaned (zero matching tenants); existing pg concurrent-query deprecation
  warning remains. Full API suite and browser walkthrough were not run. Manual
  acceptance is standing user-granted, not agent-executed. No application/production
  database changes, schema migration, deployment or commit.
- Remaining: consent profile UI, retention (deletion still cascades), narrower role
  permissions, repeat/withdrawal policy, history pagination and treatment-status
  consent requirements. Historical audit findings below are superseded only for the
  fixes above. No retention or clinical-policy changes are implied by this slice.
  Logs: /tmp/glampro-consent-{db-final,session,shared,web,build,api-types,lint}.log.

## October 22, 2026 — Treatment-consent/customer-profile audit

- Audit only; no application code or schema changes. Both TK2610-0025 and
  TK2610-0027 remain IN PROGRESS, not ready for external closure. Existing
  uncommitted photo-tagging changes were preserved. Prior acceptance is not
  evidence that the consent workflow below is implemented or verified.
- Confirmed foundation: four treatment models are tenant-scoped; consent routes
  require authentication/treatment entitlement and writes require a writable tenant.
  Event actor is taken from JWT, not the submitted actor. Form content has no API
  update/delete route; each version is a separate row. CustomerProfile mounts the
  treatment list only when entitled, but none of the four consent hooks has a UI
  caller. Profile privacy/photo consent is not a treatment-consent interface.
- High-priority integrity gaps (source inspection): recordTreatmentConsentEvent
  verifies record/form/customer existence separately, but not customer equality,
  treatment-type equality or active-form eligibility. A different customer in the
  same tenant or unrelated/inactive form can therefore be recorded. Cross-tenant
  lookup filtering exists; fresh consent-specific HTTP/DB isolation tests were not
  run. No grant/decline requirement gates treatment status changes.
- Retention gap: deleteTreatmentRecord hard-deletes; the event foreign key uses
  ON DELETE CASCADE, so deleting clinical documentation deletes consent evidence.
  Customer/form deletion also cascades. Append-only comments do not establish
  retention. All authenticated salon roles can publish forms, record consent and
  delete treatments under current routes; no narrower clinical role check exists.
  Resolve desired retention/access policy before implementing a migration.
- Executable contract probes confirmed four defects: active-form URL supplies
  treatmentType but idParamSchema requires id; treatmentRecordSchema omits and
  strips consentEvents despite the detail include; treatmentConsentEventSchema
  omits and strips included form title/content/version; request schema requires
  consentedById although the route uses JWT actor. Signature input is accepted but
  the service always stores/returns null (source inspection), not signature capture.
- Publication/race gaps (source inspection, not reproduced under concurrency):
  latest-version read, active-version deactivation and form insert are separate
  operations. An insert failure can leave no active form; concurrent publication
  can collide on the version unique key. Event precheck/insert also races; no P2002
  mapping provides a stable duplicate conflict. Unique treatment/form constraint
  prevents a second decision for that pair; no withdrawal/correction workflow exists.
- Client gaps: useConsentForms uses the same domain key for every type/active
  filter. Form list query uses unchecked casts; invalid/repeated filters have no
  shared validation. History is unpaginated; missing/foreign treatment IDs return
  an empty event list rather than checking parent existence. These need explicit
  contract choices and coverage, not inferred completion from passing older suites.
- Remediation order: (1) ownership/type/eligibility checks, route/request/response
  contracts and safe publication/duplicate handling with dedicated HTTP/DB tests;
  (2) resolve retention, permissions and repeated-decision policy; (3) profile form
  authoring/version preview, explicit grant/decline, original-form evidence history,
  filter-specific keys, read-only controls and retryable failures; (4) rerun relevant
  automated acceptance before reassessing parent readiness. No new task IDs added.
- Passed fresh: focused web 28/28 (CustomerProfile, CustomerTreatmentList,
  TreatmentRecordForm, TreatmentPhotoTagger); shared customer/session contracts
  19/19, none skipped; four temporary contract probes (exit 0). These confirm the
  existing adjacent UI and the reproduced contract defects, not consent acceptance.
  Profile tests mock the treatment child; no end-to-end consent coverage is claimed.
  Logs: /tmp/glampro-consent-audit-{web,shared,probes}.log; probe script remains
  outside the repository at /tmp/glampro-consent-audit-probes.ts.
- No database commands, migrations, browser walkthrough, full API suite, application
  deployment, commit or external tracker changes. Documentation checks recorded at
  handoff; user-granted manual acceptance does not close missing implementation.

## October 22, 2026 — Before/after photo-tagging integration completed

- Treatment history now opens a before/after drawer using fresh treatment details.
  Shared contracts retain photo metadata and list/detail/create/update serialize
  timestamps. Tagged photos remain visible independently of gallery pagination;
  one-before/one-after controls, read-only viewing and retryable load/mutation errors
  are wired. Private authenticated blobs are revoked on unmount.
- API rejects photos belonging to another customer, scopes removal to the URL
  treatment and maps duplicate-type races to 409. Removed unnecessary full photo
  byte fetch on tagging. Untagging and treatment deletion preserve original photos.
  Existing upload-consent and retained-photo rules are disclosed, not changed.
- Passed: full web 506/506, shared 143/143, expanded isolated PostgreSQL linkage/photo
  HTTP acceptance 1/1 with none skipped, final full production build, API/web
  typechecks and root lint. Six added UI tests; DB coverage includes customer/tenant
  refusal, duplicate races, retained metadata on edit, scoped untag, auth, suspended
  writes and original-photo preservation. Initial checks passed; final inspection
  caught create/update timestamp serialization, fixed and rerun successfully.
- Reused only approved disposable loopback 55440/package_expiry_test; tests clean
  fixtures. Existing pg concurrent-client deprecation warning remains. No full API
  suite or agent browser walkthrough; manual acceptance is standing user-granted.
  No migration, application database change, commit or deployment.
- Both external parents remain IN PROGRESS. Next is consent-workflow audit under
  TK2610-0025, not an assumption that historical consent work meets completion.
  Logs: /tmp/glampro-photo-{web-full,shared,db-final,build-final,lint}.log.

## October 22, 2026 — Usable POS redemption selector completed

- Added shared query/option contracts, read-only GET /api/treatments/redemptions
  before /:id, treatment query hook and TreatmentRedemptionPicker in the treatment
  form. Customer-scoped, stable paginated evidence shows receipt, salon-local date,
  package, covered service and whole-redemption quantity. New records get the
  service from their selection; edits are filtered to their immutable service.
- Filters require a matching customer holding/package, completed sale, covered
  service on that sale, unreversed redemption and no existing treatment link.
  Expired holdings remain valid historical evidence. No reservation or balance
  mutation; existing transactional save-time guards handle races and duplicate use.
- UI covers empty/loading/error/retry/pages, customer-reset selection, explicit
  unlink and preservation of current unavailable/reversed evidence. Historical
  quantities and unchanged timestamps remain preserved. Manual acceptance granted
  by standing user instruction; no agent browser walkthrough.
- Passed: isolated PostgreSQL sale/linkage/HTTP tests 56/56 (none skipped), full
  web 500/500, shared 143/143, production build and root lint. Added five UI tests,
  two shared contract tests and expanded DB acceptance for listing, paging,
  customer/tenant/service filtering, linkage/unlink/reversal, auth and entitlement.
  Initial HTTP fixture assumptions (seeded core module; validation status 422)
  corrected and rerun. Existing pg concurrent-client deprecation warning remains.
- Reused only approved disposable cluster at loopback 55440/package_expiry_test;
  fixtures cleaned by tests. No application DB migration, commit or deployment.
  Logs: /tmp/glampro-picker-{full,focused,db}.log. Photo-tagging is next; both
  parent external tasks remain IN PROGRESS.

## October 22, 2026 — Standing manual acceptance recorded

- User accepts manual tasks when agent work is complete. Recorded the standing
  acceptance rule in PROJECT.md and TASKS.md, preserving implementation, automated
  verification and operational evidence requirements.
- Recorded user-reported completion of treatment-link application migration,
  browser acceptance and privacy/access/consent review. Historical pending notes
  below are superseded by this update, not evidence of new agent-run checks.
- Documentation only; no application code, database or external tracker changes.

## October 22, 2026 — Customer-profile treatment workflow wired

- Mounted treatment history only after successful treatment-module entitlement lookup.
  Added create/edit drawers, confirmed selected-record deletion with failure/retry,
  server pagination, salon-local display and read-only write controls. Profile
  creation locks the selected customer. Unsupported edit reference fields are disabled.
  Removed the inert photo-tagging button; integration remains unfinished.
- Fixed date/time contract mismatch: accept UTC instants alongside legacy dates;
  form converts salon-local input to UTC and omits unchanged times from patches
  to preserve seconds and historical values. No balance service changes.
- Passed: focused web tests 17/17, full web 495/495, shared 141/141, full build
  (including API/web compilation) and API typecheck. Initial build exposed nullable
  API references incompatible with create input; explicit normalization fixed it.
  Scoped lint/format and final diff checks recorded with verification logs under
  `/tmp/glampro-treatment-ui-*`.
- No application database migration, live browser acceptance, commits or deployment.
  Parent task remains IN PROGRESS; redemption picker, photo-tagging wiring and broader
  clinical privacy/consent review remain, in addition to linkage rollout acceptance.

## October 22, 2026 — POS-owned treatment session linkage implemented

- User selected POS-only deductions. Added unique whole-redemption treatment link,
  derived quantity and holding, same-customer/tenant/service validation, reversal
  refusal and duplicate protection. No linking/editing/deleting balance mutation.
  Reversed evidence stays visible; unlinked historical quantities are preserved.
- Typed PATCH contract replaces the unsafe cast; explicit null clears notes/link.
  Form requests POS evidence instead of a deduction quantity. Fixed empty required
  customer-name blocker using an honest customer-reference input. List discloses
  POS-linked/reversed versus historical unverified quantities.
- Added forward migration `20261022160000_treatment_pos_redemption_link`; no backfill.
  Added shared/form tests and opt-in exact-target isolated DB acceptance covering
  ownership, service mismatch, duplicate/concurrent linking, quantity mismatch,
  reversal, cancellation/unlink/delete and historical preservation.
- Passed: DB sale/linkage 56/56; final isolated acceptance 1/1; shared 140/140;
  web 486/486; full build, API/web typechecks, scoped ESLint/Prettier, diff check.
  Concurrent test emits pg driver query-serialization deprecation warning; tests
  pass, no dependencies changed. Earlier form failures fixed, not suppressed.
- Migration verified only on disposable loopback 55440/package_expiry_test.
  Application migration/browser acceptance pending for this new linkage slice.
  No application/production DB writes, external mail, commits or deployment.
- Remaining: treatment-list action buttons are not wired, no redemption picker,
  broader aesthetics privacy/access claims still need review. Do not mark either
  full external TK2610-0025 or TK2610-0027 complete on this slice's evidence.

## October 22, 2026 — Expiry accepted; treatment-session follow-up scoped

- User explicitly confirmed application migration and browser checks are complete
  and accepted the expiry slice. This is user-reported verification, not an agent
  migration/application inspection or browser walkthrough. Expiry slice is DONE;
  full external TK2610-0025/0027 scope remains unfinished, not ready for closure.
- Read current treatment create/update, form, contracts, package relation and POS
  redemption paths. Treatment stores an editable quantity without decrementing a
  holding; form hint claims deduction. POS already consumes package sessions.
- Next bounded deliverable: treatment-session integration under TK2610-0025.
  Blocked on ownership policy: link treatments to existing POS redemptions versus
  independent treatment deduction. Must avoid consuming the same session twice;
  independent deduction also needs cancellation/edit/retry behavior defined.
- No runtime changes or new test runs in this handoff; code inspection and tracking
  validation only. Existing automated expiry results remain historical evidence.

## October 22, 2026 — Approved purchase-based package expiry implemented

- User approved optional validity days from completed purchase, existing holdings
  unchanged, no family-wide expiry changes. Exact 24-hour days; null never expires.
- Added nullable catalogue validity and bounded SQL checks in forward migration
  `20261022120000_package_validity_days`; shared contracts, session-package editor,
  owner/manager prepaid validity endpoint and holding expiry snapshots. Both direct
  and held-sale completion use completed `soldAt`; no holding backfill or write-off.
- Added pure boundary/validation tests, editor tests, real-DB purchase/held-cart
  regression and opt-in isolated endpoint acceptance. Acceptance verifies auth,
  role/module/suspension gates, foreign-tenant refusal, rule clearing, unchanged
  foreign rows and consistent spendable-holdings/liability exclusion of expiry.
- Passed: sale/package/customer services 80/80 (real DB); isolated endpoint 1/1;
  shared 139/139; web 483/483; full build, API/web typechecks, scoped lint/format and
  diff check. Initial test fixture typing/auth issues corrected before final pass.
- Broader package/report route run: 82/93 pass, 11 fail because old owner-login
  helpers do not complete mandatory SEC-01 2FA. Left unrelated suites unchanged.
  Root-invoked cross-workspace ESLint had config-root ambiguity; per-workspace
  scoped ESLint passed without config changes.
- Disposable loopback PostgreSQL cluster on 55440, `package_expiry_test`, migrated
  and tested only; fixture removed and cluster confirmed stopped. No application/production migration, external email, deployment
  or browser acceptance. TK2610-0025/0027 are not ready for external closure.
- Next: authorized application migration/browser acceptance for this slice, then
  separately scope remaining shared pool, transfer/audit and treatment consumption.

## October 22, 2026 — Package-expiry scope review

- Inspected the original product-review expiry requirements, shared/model structure,
  package grants, POS redemption, customer holdings, liability filtering and treatment
  creation. The source review names expiry but specifies no duration/start policy.
- POS already refuses stored expiry at `expiresAt <= usedAt`; spendable holdings and
  liability reads exclude expired rows. Session/prepaid purchase grants leave expiry
  unset, with no configurable validity rule. Treatment creation stores quantity but
  does not validate or consume a package holding. Family-pool redemption claimed in
  TK2610-0027 is absent from the current selected-holding redemption path.
- Withdrew unsupported task completion claims: TK2610-0025 IN PROGRESS;
  TK2610-0027 BLOCKED pending expiry policy. Neither external ID is ready to close.
- Proposed slice: optional per-package validity days from completed purchase, null
  means never expires, existing holdings unchanged, no family expiry propagation or
  write-off. No policy or runtime behavior changed pending confirmation.
- Verification: read-only code/source-document inspection and tracking diff review
  only; no runtime tests, database access, migrations or application changes.
- Preserved existing dirty tracking files and untracked authentication acceptance
  test. `rg` is unavailable; used targeted `grep`/file reads instead.

## October 22, 2026 — SEC-01 user acceptance and closure

- User explicitly confirmed "manual browser/user is accepted." SEC-01 marked DONE
  using the prior automated evidence and user-reported manual acceptance. No agent
  browser walkthrough, new test run, production rollout or account audit claimed.
- Prior checks: isolated DB/local SMTP acceptance 1/1, authentication regression
  38/38, Login/Settings UI 32/32, API typecheck and new-test lint/format passed.
- Production SMTP/account review and unrelated whole-API treatment lint failure
  remain disclosed. This closes SEC-01 only, not the P2 phase or grant task.
- Next: package-expiry work in TK2610-0025/TK2610-0027; not started this turn.

## October 22, 2026 — SEC-01 isolated database/SMTP acceptance

- Added opt-in apps/api/src/routes/auth-security.acceptance.test.ts. Requires
  SEC01_ACCEPTANCE=1 and asserts the exact disposable loopback database target
  before importing persistence. SMTP capture binds only loopback and never forwards;
  messages/codes stay in memory. No new dependencies or runtime behavior changes.
- Independent PostgreSQL 18 cluster initialized under a private temporary directory;
  all migrations applied to sec01_acceptance on port 55439. No application database
  reset, migration, seed or account changes. Test fixture removed; cluster stopped.
- Real database/SMTP acceptance 1/1; authentication regression 38/38 (no skips);
  Login/Settings UI 32/32. API typecheck, new-file lint/format and diff check pass.
- Verified mandatory owner email challenge, captured SMTP code, hash storage,
  single-use code, owner disable refusal, weak-password rejection, access/refresh
  revocation after password change and optional staff enrollment/login/disable.
- Remains IN PROGRESS for manual browser/user acceptance. Production provider
  delivery and account audit not performed; whole-API treatment lint issue remains.
- Next: manual acceptance decision for SEC-01; package expiry not started.

## October 22, 2026 — SEC-01 acceptance prerequisite check

Superseded prerequisite blocker: user subsequently approved isolated resources;
automated acceptance completed below. Earlier evidence is retained historically.

- Read-only, secret-safe configuration inspection found local application database
  `glampro_suite`, no TEST_DATABASE_URL and no SMTP_HOST. Did not use application
  data for tests or send external email. No migrations, seeding or account changes.
- Reran isolated mocked API/seed security tests: 15/15 pass, no skips. Focused
  Login/Settings UI tests: 32/32 pass. API/web typechecks and focused security API
  lint pass. These checks do not establish real-DB, SMTP or manual browser acceptance.
- SEC-01 marked BLOCKED pending approved disposable database and SMTP inbox.
  Package-expiry work remains next and was not started while this gate is blocked.

## October 22, 2026 — SEC-01 authentication implementation

- Added explicit challenge/session contracts, web verification and optional Settings
  enrollment. SUPER_ADMIN always verifies an email code; unenrolled legacy sessions
  cannot refresh/access protected routes. Owners cannot disable 2FA.
- Crypto-generated codes/challenges, purpose-bound hashes, conditional single-use
  consumption and pending-code invalidation on password change/forced sign-out.
  Removed code logging/return. No schema migration required.
- New/change owner passwords require 12 characters and reject defaults. Production
  seed validates explicit non-demo email/password before writes; NODE_ENV=production
  cannot select development crew. Existing accounts/passwords were not changed.
- Verified: full web 481/481, shared 136/136; API/web typechecks, production web build,
  web lint and changed API file lint pass. Focused API/seed security unit tests use
  mocked persistence/mail, not a database: final focused run 15/15 passed, no skips.
  Final diff whitespace check passed. Whole API lint has an unrelated existing
  no-explicit-any error at treatment.service.ts:174; intentionally untouched.
- No migrations, seeding, database tests, deployment, commits, real email or manual
  browser walkthrough performed. Full API integration suite not run because it can
  load the application DATABASE_URL; no disposable database was established here.
- SEC-01 stays IN PROGRESS pending real-DB and SMTP/browser acceptance. Production
  audit/disable of test accounts remains an explicit operator action, consistent
  with the earlier recorded decision to retain them. Coordinate web/API rollout;
  owners need accessible email and SMTP before enabling this release.

## October 20, 2026 — TK2610-0020 UAT acceptance and local migration status

- User accepted UAT and subsequently reported running `npx prisma migrate`. The exact migration subcommand was not supplied.
- Read-only workspace migration-status command reports PostgreSQL `glampro_suite`, public schema, `localhost:5432`, 28 migrations found and database up to date. Terminal integration did not provide a reliable exit status; the Prisma status output was captured. This is migration-history evidence, not a schema-drift check, production rollout or post-migration smoke test.
- No migration or activation was run by the agent. No new application tests were run for this documentation update. The simultaneous-request staff/resource race remains unchanged; TK2610-0020 stays IN PROGRESS pending resolution of its concurrency criterion.

## October 20, 2026 — TK2610-0020 Phase D rooms/equipment

- User explicitly selected **A — full slice**. Added tenant-scoped `Resource` and `ServiceResource`, shared contracts and migration `20261020200000_resources`; appointment lines expose nullable resource ID/name. One row per physical resource, unique tenant/name; deletion FK is SET NULL, management archives by status.
- Service links are an eligibility set: each occupying line selects **one** active free room/equipment in name/id order. No links means no resource required. Half-open overlap, all non-cancelled statuses occupy; per-line windows and per-occurrence checks. Later series resource conflicts skip/report rather than aborting the series.
- `/api/resources`: member GET list/detail; SUPER_ADMIN/MANAGER POST/PATCH with entitlement and writable-tenant checks. Resource `serviceIds` replaces eligibility; foreign service references refused. No separate service-resources endpoint or DELETE. Join rows are created at top level inside a transaction so tenant stamping runs (nested creates do not receive extension stamping).
- Settings card supports room/equipment creation, editing, archive and eligibility. All catalogue pages, including retired services, load before editing; later-page errors block edits rather than showing a partial set. Drawer displays booked resource names without manual selection.
- Added equipment/multi-line conflicts, notes-only and archived-history preservation, cancellation, reschedule/reassignment, reactivation refusal, tenant read/write/create stamping, foreign eligibility references, drawer display and catalogue-pagination/error tests. Existing Settings page mocks now cover the new card queries.
- Checks: focused resource service/routes/tenant isolation **35/35**; full API **463/464** (no skips), web **474/474** across 55 files, shared **130/130**. Only API failure: pre-existing messaging quiet-hours test, expected `ALREADY_REBOOKED`, actual null. An earlier API run overlapped Prisma generation and hit a missing generated module; the final run did not overlap generation and has no such failure.
- Workspace typechecks, lint and build passed; web typecheck/lint rerun after the catalogue fix passed. Touched-file Prettier, Prisma validation and `git diff --check` passed. Removed unrelated whole-schema formatting churn introduced by Prisma format.
- Database verification used only `glampro_tk0020_d` and newly created `glampro_tk0020_d_replay`. Fresh `migrate deploy`, zero-drift schema diff, validation and seed twice passed; replay DB had 13 appointments / 13 lines / 0 missing lines. Both disposable databases were dropped after checking for active sessions; catalog verification confirms neither remains. Final web production build also passed after the catalogue fix. No application database changes, commit or deployment. No browser UAT claimed.
- Residuals: concurrent overlap race unchanged (no EXCLUDE); existing lines without resources are not retroactively assigned; archive retains the resource relation/name, not a name snapshot (renaming changes the displayed name). Eligibility does not model simultaneous room-plus-equipment needs. Overall task remains IN PROGRESS for UAT/rollout and unresolved concurrency completion criterion.

## October 20, 2026 — TK2610-0020 Phase C recurring series

- Scope chosen by the user: Phase C first, then Phase D in the same session only
  if C landed clean. C landed; D was not started because it is a separate
  greenfield resource model and was not part of that authorization.
- Model: a series is the **rule only** — `AppointmentSeries` holds `intervalWeeks`
  (1–8) and `occurrences` (2–52); each occurrence is a normal `appointment` row
  carrying `seriesId` + `seriesIndex`, with its own lines, so every existing
  reader and the per-line clash rule work unchanged. The FK is `SET NULL` on
  delete: retiring a rule must never delete the bookings it produced.
- Step: `addWeeksInZone` moves the anchor by whole weeks and then corrects by how
  far the zone's own offset moved the wall clock (folded modulo a day, so a shift
  across local midnight is not read as a 23-hour error). Unit-tested in
  `wall-clock.test.ts` for both DST directions and the midnight case.
- Create semantics: the anchor is booked normally (a clash is a `409`, and a
  refused anchor writes no rule row); later occurrences are skipped, not fatal,
  on `APPOINTMENT_CLASH`/`STAFF_UNAVAILABLE`, and the response's `series` block
  reports `created` + `skipped[{ startsAt, reason }]`. Everything is written in a
  single transaction. `data` in the response is still the anchor booking, so no
  existing client changed shape.
- Exit: `POST /api/appointments/series/:id/cancel` cancels future `SCHEDULED`
  occurrences only (completed and no-show history is never rewritten) and returns
  `{ cancelled }`; a second call is a `0` no-op. Tenant scoping makes another
  salon's series a `404`.
- UI: the drawer gains a Repeat fieldset on create (weekly / 2 / 4 weeks, 2–26
  bookings), an "info" toast naming the dates it had to skip, and — on an
  occurrence — a "Part of a repeating series — every N weeks, booking X of Y"
  note with "Cancel the rest of the series".
- Also fixed (Phase B omission found by the full typecheck): two
  `calendar-geometry.test.ts` fixtures were missing the now-required `services`
  array.
- Verified on disposable PostgreSQL `glampro_tk0020_c` (dropped afterwards):
  migrations from empty, `migrate diff` empty, seed → 13 bookings / 13 lines;
  API 440/441 (the one failure is the quiet-hours/time-of-day flake above), web
  465/465, shared 122/122; API/web typecheck, workspace lint, touched-file
  Prettier, `prisma validate` and `git diff --check` clean.
- Known limits: a series is not editable as a whole (edit one occurrence, or stop
  the future ones); no "skip this date" exclusions; recurrence is weeks-only (no
  monthly/two-weekly-with-skip rules); each occurrence queues its own message
  jobs, so a long series queues many; the concurrent-overlap race and the missing
  Postgres `EXCLUDE` constraint are unchanged (ADR 0014); application DB not
  migrated, no commit, no deployment.

## October 20, 2026 — TK2610-0020 Phase B multi-service bookings

- User chose Phase B (multi-service lines) as the next slice. Design: a booking is an ordered chain of `AppointmentLine` rows rather than a join table with derived times, because the overlap rule can then ask Postgres which line collides without replaying durations, and a line keeps its window when a later one is removed.
- Schema/migration: `appointment_lines` (`id`, `tenantId`, `appointmentId`, `serviceId`, `staffId?`, `position`, `startsAt`, `endsAt`, `durationMinutes`), unique `(appointmentId, position)`, index `(tenantId, staffId, startsAt)`, check `endsAt > startsAt AND durationMinutes > 0 AND position >= 0`; migration `20261020155000_appointment_lines` backfills one line per existing booking with a deterministic id, falling back to the window length when `durationMinutes` was null (verified by re-running the SQL over a hand-seeded legacy row).
- Model compatibility: `Appointment.serviceId`/`staffId`/`durationMinutes` are line-0 mirrors and `endsAt` is the last line's end; `toSummary` reads line 0 and falls back to the flat columns for rows without lines, so the list, calendar, messages and receipts keep working unchanged.
- Service: `planLines` resolves each service, checks the performer against that line's service, chains windows from `startsAt`; `assertStaffFree` and `assertNoClash` run per line (with an appointment-window fallback for rows with no lines); `createMany`/`deleteMany` rewrite the chain only when it actually changed; `AppointmentLine` added to `TENANT_SCOPED_MODELS`.
- PATCH semantics: `services` replaces the chain, `serviceId` is the single-service form, both at once is a 422; a booking-level `staffId` move applies to line 0 only, and lines keep their own performer.
- UI: the drawer's single Service/Performer pair became an ordered list with "Add service"/"Remove", per-line performer filtering and a summed end-time preview; the first row keeps the old labels so the existing form tests still describe the same control.
- Checks run: appointment service suite 22/22, appointment routes 9/9, `prisma.test.ts` 4/4, tenant isolation now covers `AppointmentLine`; full API 429/429 and web 461/461 on `glampro_tk0020_b`; API/web typecheck; API/web lint; Prettier on every touched file; `prisma migrate deploy` from empty and `migrate diff` empty; `prisma db seed` twice → 13 bookings, 13 lines, 0 without lines. Disposable DB dropped; application DB untouched.
- Known gaps: true concurrent overlap still needs a Postgres `EXCLUDE` constraint (ADR 0014). No browser walkthrough claimed; the drawer was verified through its rendered tests only.

## October 20, 2026 — TK2610-0020 Phase A booking lifecycle

- Assessed before editing: multi-service, recurring series and rooms/equipment do not exist (one `Appointment.serviceId`, no series or resource model). Phase A therefore fixed lifecycle defects only and did not invent schema.
- Fixed: creating on an inactive service returns `SERVICE_INACTIVE` naming `serviceId`; PATCH keeps retired services editable because active status is required only when `serviceId` changes; rows created already `CANCELLED` skip roster and clash checks (parity with PATCH, ADR 0014 §3); clash messages quote the tenant's zone via new `lib/salon-clock.ts`, reused by staff availability; performer refusals carry `details[0].path = "staffId"` so the drawer marks Performer.
- Undocumented `191a1e3` behaviour (duration snapshot on reschedule, resize clash, status-reactivation clash) is now covered by regression cases, plus cancelled-create parity, salon-zone message, performer details and the route's inactive-service envelope.
- Checks: appointment service+routes 24/24, sale suite 54/54 alone, full API 422/422 on rerun (one unrelated sale flake on the first), web 460/460, typecheck/lint/Prettier/`prisma validate` clean. Disposable `glampro_tk0020_a`; application DB untouched.
- Not done: Phases B–D, Postgres exclusion constraint, commit, deployment.

## October 20, 2026 — TK2610-0021 code handoff

- User accepted UAT on October 20, 2026 for approved code/documentation scope. This is user-reported acceptance, not agent-observed UAT or verified live delivery. No application migration or activation authorized or performed by this acceptance.
- Implemented WhatsApp/SMS settings and channel consent UI, immutable channel evidence, one explicit preferred automatic channel and withdrawal propagation on phone/data/marketing changes. Twilio credentials stay operator-managed, never frontend settings.
- Added durable transactional booking jobs, independent worker with conditional claims and customer/booking locks, dispatch-time eligibility checks, stale-link/job invalidation, bounded rate-limit retries, uncertain-send/restart handling and monotonic signed callbacks. Explicit receipt channel selection is deduplicated; existing email receipt behavior unchanged.
- Added hashed expiring secure receipt and action links with revocation, attendance confirmation separate from lifecycle, customer cancellation confirmation/cutoff, minimal no-store/no-referrer public HTML, signed STOP and secure one-way-SMS unsubscribe links. Uncertain sends retain committed usable links.
- Added `docs/whatsapp-sms-integration.md`: secrets, origin/proxy/log redaction, salon-owned senders, WhatsApp sandbox/onboarding/template mappings, Singapore SMS registration, worker commands, consent/retention limitations, troubleshooting and explicit real-device activation checklist. Both channels and global worker disabled by default.
- Checks: 24 focused messaging tests; full API 415/415 no skips; web 459/459; shared 116/116. Workspace typecheck, lint and full build exit 0. All 25 migrations replayed to disposable PostgreSQL at port 55461, current status and empty DB/schema diff; built disabled-worker smoke check passed. API emits existing pg concurrency deprecation warnings. No application migration, real provider calls, browser/manual UAT or production verification.
- Remaining operations: authorized credential/sender/template setup, approved consent/retention policy, HTTPS/proxy redaction and test-handset live checklist. No automated retention purge or provider exactly-once promise. npm audit reports 12 findings (2 critical, 8 high, 2 moderate); Twilio and xmlbuilder are the only lockfile additions and are not among reported affected packages. No audit fix, commit, deploy or external tracking update.

## October 20, 2026 — TK2610-0019 closure

- Reproduced paid-commission deletion with new regression tests before fixing `reverseForVoid`. Paid records now retain amount/rate/payment date and require reconciliation; unpaid rows are removed in the same transaction. Report reconciliation includes VOID sales by void date without adding paid rows to earned totals.
- Added unpaid-only, paid-only and mixed regression cases covering concurrent/later void retries, exact paid-row preservation, report-date boundaries and earned-commission exclusion. Existing paid/unpaid refund regression still passes.
- Checks: sale suite 54/54; full API 391/391, none skipped; API typecheck, workspace lint and full build passed. Application tests used only disposable PostgreSQL.
- Applied only the two pending staff migrations using migrate deploy to configured development database localhost:5432/glampro_suite. All 24 migrations up to date; read-only checks verified completed migration history, nullable email, new commission/PIN column types/defaults/nullability and validated commission-rate range constraint. No reset/reseed or business-row changes by verification.
- User UAT accepted; completion checks met. TK2610-0019 DONE in local tracking; external task tracker unchanged. No new schema migration required for void fix. No commit, production migration or application deployment.

## October 20, 2026 — TK2610-0019 assessment and policy

- Existing staff profiles and recurring shift APIs are partial foundations. Roster UI, booking availability enforcement, commission accrual and email-free POS PIN access remain required. Shift PATCH and effective-date validation need correction.
- User selected configurable per-staff percentage commission on service revenue after discounts, excluding tax, credited to the line performer. Package purchases earn none; service redemptions earn on their allocated service value. Direct tips remain separate.
- Implementation defaults disclosed: authenticated-session POS-only PIN switching with no privilege elevation; no-roster staff retain unrestricted bookings, configured hours/breaks are enforced without manager override.
- Implemented staff roster editor in the staff drawer with all-page reads and later-page failure reporting, WORK/BREAK and effective-date edits; partial shift updates validate merged bounds and break coverage includes effective dates. No overnight shift row; split work across weekdays. Booking writes enforce configured roster in salon time (real-minute traversal handles DST); no-roster staff remain unrestricted. Disabled performers are refused.
- Commission rate defaults to zero and is editable by existing management routes/UI. Completion accrues per service line on net revenue minus snapshotted tax, rounded per line; ignores package purchases/products/tips, including service revenue paid through package/credit tender. Rates and amounts snapshot in EmployeeCommission; idempotent completion, unpaid refund adjustments and paid-refund reconciliation retained. No payroll/payout UI added.
- Email-free staff use nullable User.email, a random unusable web password and hashed six-digit PIN. Existing email logins preserved; PIN-only staff cannot obtain web sessions or management roles. PIN assertions bind tenant, operator and current bearer session; expire after 15 minutes/session renewal, reset/revocation/disable invalidates them. Sales consume assertions only for cashier identity, never line attribution or API privileges. Frontend keeps assertions only in memory and clears on sign-out. Verification limits ten failed attempts/IP per 15 minutes with process-local storage.
- Migrations: 20261020160000_staff_commission_rate (including SQL 0–100 constraint), 20261020170000_staff_pos_pin. Applied with the previous 22 migrations on a new isolated PostgreSQL cluster; no application DB access/change.
- Checks: shared 112/112, API 388/388, web 452/452, none skipped; workspace lint, API typecheck and full build passed. Los Angeles-host shift suite 21/21 and Auckland-host new UI suites 5/5 passed. Corrected an ambiguous pre-existing sale-test fixture lookup to its exact seeded email after full-suite evidence. Scoped formatting/diff review performed; no browser UAT claimed.
- User accepted UAT on October 20, 2026; no agent browser walkthrough claimed. The closure entry above supersedes the previously pending local migration rollout and paid-commission void review. Existing non-atomic booking/rota race unchanged. No commit/application deployment.

## October 20, 2026 — ESLint cleanup and TK2610-0018 closure

- User explicitly authorized removing suspicious appended code from all three workspace ESLint configs. Removed only the payload and its createRequire bootstrap; compared against HEAD to confirm every existing lint rule/configuration was preserved.
- Checks actually run: workspace lint passed for API/web/shared; node --check passed on all three configs; config formatting passed. Web lint still emits an npm unknown-config warning for --skipwarn, but exits successfully. No application tests rerun for config/documentation-only cleanup; earlier application verification is recorded below.
- User-reported calendar UAT was already accepted. Final lint blocker resolved; TK2610-0018 marked DONE. No commit, deployment or database changes. Next: TK2610-0019 assessment, not started.
- Cleanup is scoped, not proof of a clean environment. Payload provenance, prior execution impact and other possible affected files remain uninvestigated.

## October 20, 2026 — TK2610-0018 calendar extension

- User explicitly accepted UAT on October 20, 2026. This supersedes the pending-UAT notes below; acceptance is user-reported. Task is BLOCKED only on unsafe lint-config review/verification, not on calendar UAT. This update changed tracking documents only; no tests rerun or security cleanup authorized.
- Week now renders Monday-first day/staff tracks plus Unassigned, with quarter-hour drops. Month dates accept drops preserving salon-local start time and staff; padding rejects drops. Overflow expands to expose all bookings for edit/drag.
- Calendar/roster consume all pages before success; later-page failure surfaces an error. Calendar overlap reads include carry-in bookings without changing list semantics. Week/month occupy each intersected date; exact midnight ends do not occupy the next day. Day/week keep disclosed 08:00–20:00 gutters and share lane geometry.
- Reschedules preserve duration snapshots unless service changes; optimistic start/end move together and roll back on failure. Added shared overlap query flag, API integration coverage and web drag/data tests. ADR 0018 updated with user approval.
- Verified web 446, shared 107, API 380 with zero skips on a new isolated PostgreSQL cluster after applying the existing 22 migrations. API/web builds/typechecks passed; host-timezone regression tests passed. No browser UAT claimed.
- Security finding: pre-existing obfuscated code appended to all workspace ESLint configs; attempted web lint spawned unexpected clipboard errors and was stopped. Do not execute configs until reviewed. Left unrelated files untouched. Production/live DB unchanged; temporary test cluster used only for verification.

## Earlier session snapshots (historical; superseded by Current State)

- October 20 local rollout completed with explicit user approval: verified target
  localhost:5432/glampro_suite and exactly two pending migrations; applied
  `20261020120000_product_barcode` and `20261020140000_direct_staff_tips` using
  migrate deploy. All 22 migrations now up to date. No reset/reseed. Final web
  rerun 433/433; API 377/377 isolated DB, shared 107/107; lint/typecheck/build,
  scoped formatting and diff checks pass. Browser/scanner/tip UAT remains the
  acceptance gate for TK2610-0017; no commit/deployment and no 0018 work.
- October 20 tips continuation: user approved option 1 (direct-to-staff records,
  one recipient, separate full-return audit; salon collection disabled). Implemented
  additive migration, tenant-scoped API and receipt-side panel. API 377/377 with no
  skips on isolated PostgreSQL, web 433/433, shared 107/107; lint/typecheck pass.
  Production build and final diff review passed. Local salon DB unchanged; barcode and
  direct-tip migrations need approved rollout. Browser/scanner/tip UAT remains.
  TK2610-0017 IN PROGRESS; do not start 0018. No commit or deployment.
- October 20 continuation: barcode implementation is automated-test verified, but local rollout and physical-scanner/browser UAT remain. API 375/375 against an isolated temporary PostgreSQL cluster (none skipped), web 429/429, shared 104/104; root lint/typecheck/build pass. Root formatting still fails only on four unchanged API files. Local salon database is unchanged: `20261020120000_product_barcode` remains pending. Tips require explicit policy approval; TK2610-0017 stays IN PROGRESS. No commit/deployment/external tracker update.
- Current task: TK2610-0017 / P1-07 POS upgrades is **IN PROGRESS**. User accepted policy features and historical browsing/held-list pagination. Hold-create retry keys now persist across unchanged retries/reloads, with in-flight edit guards. User accepted current-catalogue pickup/safe replacement UAT on October 19. Backend reversal/receipt-retention hardening now passes automated checks. Barcode and tips remain; tip policy needs approval. Do not start TK2610-0018.
- Latest checks (October 19): API 371/371 (database enabled, none skipped), web 424/424, shared 101/101; root typecheck, lint and production build passed. Forward receipt-retention migration applied locally; 20 migrations up to date. Current continuation changes are uncommitted. No agent browser walkthrough or deployment. Logs: `/tmp/pos-integrity-*.log`.
- Most recently completed: TK2610-0016 customer profile. On October 19 the user explicitly confirmed testing and acceptance, and requested POS upgrades. Prior rollout and automated checks remain historical evidence; no agent browser walkthrough. Ready to mark Done externally. Existing uncommitted implementation changes preserved.
- Milestone verification (October 19): root production build, typecheck and workspace lint exit 0; web 392/392, shared 92/92 and pure demo-dataset 13/13 tests pass. Root formatting still fails on four unchanged API files. No database-backed API rerun or browser walkthrough; earlier API 339/339 is historical evidence. See the milestone handoff below for the readiness checklist and accepted demo limits.
- Most recent work: TK2610-0012 / P0-06 reports (commit `18c973f`) audited against its completion check and signed off after UAT. The Z-report draws the salon-local day, counts voids by `voidedAt`, splits collected from redeemed and carries the snapshotted GST. The overview returns sales-by-day, top items, service and staff totals with commission, tender subtotals and a liability snapshot that excludes expired/exhausted holdings. ADR 0010 conflict closed: `?threshold=` filters only while row badges use the stored tenant threshold, with a new row-flag test. Verified: API 339/339, web 392/392 across 43 files, API typecheck/ESLint/scoped Prettier and web typecheck pass. That ADR 0010 edit and a Prettier re-wrap of `report.service.ts` are uncommitted.
- Earlier: TK2610-0011 / P0-04 local payment methods and redemption. The four local rails are **recorded tenders** (`PAYNOW_SGQR`, `NETS`, `GRABPAY`, `ATOME`); `PACKAGE` and `PREPAID_CREDIT` are redemption tenders that carry a `holdingId`, draw the holding inside the sale transaction and are restored on void; `GET /api/customers/:id/holdings` feeds the payment sheet. Migration `20261019034125_local_payment_methods_and_redemption_holding` applied locally. ADR 0019 records both decisions (manual recording; credit is fungible). Committed as `c2274bc`.
- Earlier: TK2610-0010 / P0-02 receipts **DONE** — user UAT on October 19, 2026 accepted an email-only scope (WhatsApp deferred to TK2610-0021). `Sale.gstRegistrationNumber` snapshotted at completion; `POST /api/sales/:id/receipt/email` renders the stored receipt; the till has an "Email receipt" dialog.
- Earlier: SETUP-05 database verification and repair. Schema drift found (live DB missing `tenants.time_zone`/`locale` and `tenant_operating_hours` despite `_prisma_migrations` rows; P0-09's 2FA columns existed only in `schema.prisma`). Repaired additively via `npm run db:migrate`: applied pending `20261015210000_tenant_localisation`, `20261016151623_tenant_operating_hours`, and newly generated `20261018141510_user_two_factor_auth` (purely additive, reviewed). No reset/reseed. Backup: `backups/glampro_suite_2026-10-18.dump` (pg_dump); `backups/` gitignored; `.env` never committed.
- Environment facts: PostgreSQL at `localhost:5432`, db `glampro_suite`, shadow `glampro_shadow` also on 5432. Commented-out `SHADOW_DATABASE_URL` in `apps/api/.env` points at stale port 5433 (nothing listens) — use 5432 for shadow commands.
- Verification (SETUP-05, October 18): `prisma migrate status` → 12 migrations, up to date at that time (14 now, after GST and the sale GST-number snapshot); `prisma migrate diff` live-DB↔schema and migrations↔schema both empty (exit 0); 0 rolled-back migrations; API tests 308/308 passed then.
- One stale test fixed: `apps/api/src/routes/auth.routes.test.ts` replay case still asserted pre-P0-09 family revocation; now asserts ADR 0007 behavior (replay → 401 `SESSION_INVALIDATED`, rotated pair stays valid). Test-only change; service behavior unchanged. This was the blocker hiding behind the DB seed failure.
- P0-09 / TK2610-0005 remains DONE; its "integration tests blocked" caveat is now cleared.
- TK2610-0008 / P0-05 — DONE: user completed UAT and marked it done in the external system on October 19, 2026. Its Products.tsx/test changes are committed in 80bd83b (verified via git log; the earlier "uncommitted" note was stale).
- Earlier records report P0-07, P0-08, P0-03 and P1-09 Done. This consolidation does not independently revalidate their product behavior.

## Unresolved decisions and carried-forward findings

### October 20 — TK2610-0017 barcode continuation

- Existing nullable tenant-unique barcode migration, catalogue contracts/form and exact POS lookup retained. Leading zeroes survive; codes are trimmed/upper-cased. Blank/null clears, omitted update preserves; duplicates are scoped to the salon. Archived and foreign products cannot resolve as scan matches.
- Removed unused POS import. Added synchronous scan-submit guard and draft-version invalidation on cart/customer/hold/checkout/receipt/context changes and unmount, so delayed lookup results cannot edit a changed draft. Scans are explicit keyboard-wedge/manual code + Enter, not a camera integration or global keyboard listener. A concurrent scan is ignored while a lookup is pending; scans are not queued.
- Added shared normalisation/clearing/length coverage, catalogue duplicate/tenant/preserve/clear tests, exact/inactive/foreign barcode service tests, and browser repeated-scan/stock/near-match/delayed-response tests. Repaired existing barcode route tests: fixture writes need explicit platform scope, `dataOf` already unwraps the response, array comparisons need deep equality, and mixed name-search results are not all exact barcode matches.
- Verified: API 375/375 with no skips after all 21 migrations replayed in an isolated PostgreSQL 18 cluster on port 55439; cluster stopped after tests. Web 429/429, shared 104/104; root lint/typecheck/production build and git diff check pass. Root Prettier still reports the same four unchanged API files. Earlier whole-tree formatting noise in those files was removed only after comparing to formatted HEAD; unrelated work retained.
- Local salon migration status explicitly reports the barcode migration pending. Do not claim local rollout or browser acceptance. No local database migration/reset/reseed, commit, push or deploy. Logs: `/tmp/barcode-*.log`, `/tmp/glampro-barcode-db/`.
- Next: approve tip collection/allocation/tax/refund policy before implementation. Barcode UAT after rollout: save and clear a code; reject a duplicate; scan twice to increment one product; reject unknown/inactive/out-of-stock codes; verify leading zeroes and Enter from a physical scanner. TK2610-0017 remains IN PROGRESS; do not start TK2610-0018.

### October 19 — TK2610-0017 pickup accepted; backend reversal/receipt integrity

- User confirmed UAT acceptance for current-catalogue pickup/safe replacement and authorized continuation. This is user-reported acceptance, not an agent browser walkthrough.
- Void now reloads status/lines/points after taking the shared sale lock; waiting concurrent void retries return the first reversal receipt/audit without duplicate effects. Refund likewise uses post-lock lines, points, customer and total.
- Missing product on void/restocking refund and missing redeemed package/credit on void now fail the whole transaction instead of silently skipping restoration. Explicit no-restock refund remains valid under existing policy.
- Granting-sale void locks holdings before checking spent state. Package/credit redemption takes the corresponding holding lock before reading it; consume/delete races cannot both succeed. Outstanding row is locked before later-payment checks; there is currently no service writer for later outstanding payments, so no end-to-end collection race was claimed.
- Applied reviewed forward migration `20261019210000_receipt_parent_retention`: Sale customer/cashier and SaleLine performer deletion now RESTRICT rather than CASCADE. No rows deleted/backfilled. Route fixture cleanup explicitly removes fixture sales before staff. Account archival remains supported; hard deletion of linked parents is intentionally refused.
- Verified API 371/371 (DB enabled, no skips), web 424/424, shared 101/101; root typecheck/lint/build pass; Prisma validate/generate pass and migration status reports 20 up to date. New regressions cover concurrent void replay, missing-product rollback/no-restock refund, completed/void receipt parent deletion, and granting-sale reversal versus package/credit consumption. One new race-test fixture used the wrong seeded credit name; corrected and reran.
- Limits: receipt names remain live references, not immutable name snapshots. Whole-tenant erasure policy is not changed. Locks protect tested race paths but exhaustive multi-holding/deadlock/load testing is not claimed; transaction errors still roll back. No new backend browser UAT, production deploy, agent commit, reset or reseed.
- Keep TK2610-0017 IN PROGRESS. Next: barcode scanning; tips require a concrete policy proposal/approval. Do not start TK2610-0018.

### October 19 — TK2610-0017 current-catalogue pickup and safe replacement

- Added read-only `GET /api/sales/:id/resume` with a shared response contract. Exact kind/id readers reuse catalogue active/expiry checks and entitlement guards, return both current prices, and reject missing/non-held/foreign sales. Historical receipt/hold prices are not rewritten. No migration or stock/financial writes.
- Pickup preserves line order, quantities, staff and discount rates; member/customer changes now use current regular/member prices. Customer read and complete cart conversion succeed before replacing the draft.
- Existing draft/customer/resumed hold requires replacement confirmation. Cancel/failure keeps the draft. A synchronous in-flight guard blocks overlapping pickup/discard and cart/customer/payment actions; history opening is guarded during hold actions. Unmount/identity cleanup prevents late pickup from replacing a newer cart.
- Verified API 367/367 (database enabled, none skipped), web 424/424, shared 101/101; root typecheck/lint/production build pass. Coverage includes changed/member pricing, 10%/100% discounts, missing/inactive/unentitled items, non-held/foreign sales, exact lookup beyond limited search, no pickup ledger/counter/stock effects, confirmation/cancel/failure and late-response behavior.
- Initial tests exposed the old S$80 historical-price expectation versus correct S$70 member pricing, a wrong inactive-status fixture and an incorrect customer-button selector; corrected and reran without weakening behavior checks.
- Limits: pickup is not ownership, stock reservation, or a price guarantee. Concurrent changes after the read are still possible; completion remains authoritative. Reload restores the browser quote rather than continuously re-fetching it. No browser UAT, deployment, commit, reset or reseed. Existing uncommitted work preserved.
- Task remains IN PROGRESS. Next: backend reversal/receipt-retention integrity, then barcode/tips (tip policy still needs approval). Do not start TK2610-0018.

### October 19 — TK2610-0017 durable hold retry keys

- Confirmed API already stores tenant-scoped unique idempotency keys for HELD writes and returns the winner on duplicate requests. The browser previously omitted the key. `useHoldSale` now persists a UUID plus submitted-input fingerprint in the existing tenant/user draft before posting; unchanged retries reuse it after reload. Successful writes clear the attempt; a changed submitted cart gets a new key.
- In-flight holds disable customer/cart edits and other hold pickup/discard actions; catalogue add handlers ignore edits while pending. This prevents successful hold completion from clearing edits made during the request.
- Tests cover retry after lost response/reload, key rotation after success, fingerprint/identity isolation, pending edit/payment locks and database-backed concurrent/sequential replay with one hold, no receipt-counter change, no tenders and no performance/points/outstanding rows.
- Checks: focused UI/storage 44/44 and sales routes 48/48; full API 364/364, web 420/420, shared 101/101; typecheck/lint/build pass. An initial web run overlapped rebuilding shared output and failed imports; rerun after the build passed. No assertions weakened. No new browser walkthrough, schema migration, commit or deployment.
- Limits: this protects unchanged retries, not a changed cart after an uncertain response. Check the held list before submitting an edited cart as a new attempt. Key records are removed when a hold is discarded, so indefinite replay after discard is not guaranteed. Remaining resume repricing and backend reversal/receipt-retention concurrency are not declared verified or resolved.
- Next: current-catalogue resume pricing and safe pickup review within TK2610-0017; barcode/tip work follows. Manual fault-injection acceptance of this retry fix remains unperformed.

### October 19 — TK2610-0017 historical browsing and held-list pagination

- Sales listing now accepts optional `page`, returns `page`/`hasMore`, preserves default HELD and existing `limit`, and uses stable soldAt/id ordering. Previous/Next controls make older holds reachable. Offset pages are live views: concurrent writes can shift rows, not a frozen export.
- On-demand completed/voided history opens the stored receipt using existing email/print/refund/void UI. Back to cart preserves cart lines, customer and resumed-hold ID; history never pre-fills email from the unrelated active customer. Manager and writable-tenant gates remain on reversals; server guards remain authoritative.
- New tests cover pagination beyond the last page, equal-timestamp paging, foreign-tenant exclusion, cashier historical reads, invalid page input, status/page switching, receipt-open failure, reversal visibility and resumed-cart preservation through subsequent completion. API 363/363, web 417/417, shared 101/101; typecheck/lint/build, scoped formatting and git diff check passed after fixing new fixture typing/data requirements.
- User confirmed manual acceptance on October 19, 2026. This is user-reported acceptance, not an agent browser walkthrough. No schema migration, commit or deployment by the agent.
- Next: continue hold retry/repricing/integrity review, then barcode/tips; tip policy needs a concrete proposal before implementation. Keep TK2610-0017 IN PROGRESS.

### October 19 — TK2610-0017 approved policy implementation

- Added forward migration `20261019190000_pos_loyalty_refund_policy`; no historical recalculation or destructive reset. Loyalty input/result snapshots live on sale lines; payout evidence is nullable JSON on refunds for historical compatibility. Performance/commission adjustment markers and commission payment/reconciliation state are additive.
- Service and UI enforce actual positive cent-exact payout splits. Server refuses debt, redemption or grant sales. Original completed sales/tenders and consumed vouchers stand; refund transaction appends points/performance/unpaid-commission reversals once. Paid commissions are flagged, not recovered. Reporting recognizes reversal dates and separates gross/refunds/net and incoming/outgoing tenders.
- Verified all suites and build/type/lint/schema checks above. Added discounted/member/quantity flooring, zero-price, debt/tender independence, historical snapshots, eligibility refusal, exact split, paid commission and refund-period coverage; retained idempotency/concurrency tests. Browser test now submits actual split money methods.
- Limitations: pre-policy commission records have no paid evidence; reconcile actual historical payouts before operational use. No payment/reconciliation management UI introduced. Item/service rankings remain gross after-discount sales; overall/day/staff figures reflect refund-date reversals. Historical refund payouts remain unknown rather than fabricated.
- User accepted UAT for the delivered slice on October 19, 2026. This is user-reported acceptance, not an agent browser walkthrough. No additional runtime tests were run for this documentation-only update.
- Next: remaining TK2610-0017 POS scope only; UAT for the delivered slice is accepted. TK2610-0018 not started.

These are historical code-review findings, not fresh runtime reproductions. Verify
against current code when starting the related task. No policy is changed here.
Full decision context and evidence qualifications now live in `PROJECT.md`,
Architecture decisions (ADR 0002–0019), and Design integration (Design 1–7).

- ADR 0002: legacy-ID importer and repeat-run fixture verification are not implemented;
  do not infer migration readiness from schema support or seed-generated IDs.
- ADR 0003 / P1-05: customer email normalization is missing; blank input rejects
  rather than normalizes to NULL. Review case-fold collisions before data changes.
- ADR 0004: platform console is an unscheduled architecture direction, not an
  implemented app or an authorization to add a privileged surface.
- ADR 0008: old centered-card review conflicts with the documented October 8 split
  layout. Preserve later composition; inspect Login before claiming fidelity.
- ADR 0014 / P1-02: status-only cancelled reactivation bypasses clash checks;
  cancelled targets may be wrongly refused. Add regression checks for both paths.

| Related task          | Finding / decision needed                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-09; ADR 0007       | Replay behavior resolved: replay rejects without family revocation per ADR 0007, test aligned October 18; password change atomic; forced sign-out exists. Owner recovery/account-removal scope still open.                                                                                                                                                                                                                   |
| P0-06; ADR 0010       | **Resolved October 19, 2026:** `?threshold=` now filters only; each row's `lowStock` badge uses the stored tenant threshold, and `catalogue.service.test.ts` asserts the badge on a row that the override pulled into the list. Reintroducing one threshold for both would reopen this finding.                                                                                                                              |
| P0-02; ADR 0011       | Legacy unnumbered completed receipts have no established backfill guarantee. Held sales also have null numbers; a completed receipt's “number pending” copy must not promise an unsupported future allocation.                                                                                                                                                                                                               |
| P1-07; ADR 0017       | ADR says discounts reduce loyalty points; code/test award catalogue points × quantity. Resolve policy first. Performance totals are not cash collected or commission. Receipt disclosure can omit a positive rate rounded to zero money.                                                                                                                                                                                     |
| P1-07; ADR 0015       | Held-sale review found incomplete listing, stale/current-price mismatch, double-discount preview, lost hold identity after reload, cart replacement and duplicate drafts on uncertain-response retries without idempotency keys.                                                                                                                                                                                             |
| P1-07; ADR 0016       | Void reverses ledger state but does not refund payment. Concurrent replay, missing-product stock restoration, cascading receipt deletion, voided outstanding balances and stale report/customer caches need review; prior tests did not prove every ledger case.                                                                                                                                                             |
| P1-02; ADRs 0013/0014 | Decide duration snapshots versus catalogue refresh on every patch. Service-only and catalogue-driven resizing can bypass clash checks gated on startsAt/staffId. Department eligibility is rechecked, but server lookups do not enforce picker active-status filters; mismatches lack field detail. Till department narrowing is advisory. Review concurrent overlap enforcement; prior tests did not establish race safety. |
| P1-01; ADR 0018       | Day/week/month views exist. Review salon-zone boundaries against newer P0-08 changes; old browser-local findings may be superseded. Week drag/drop, crossing-midnight display and first-page truncation remain scope to assess; read-only presentation is not proof of edit authorization.                                                                                                                                   |
| P0-04 / P1-03 / P1-04 | P0-04's manual-recording decision is now recorded (ADR 0019): no provider onboarding is required for the four local rails, and the remaining provider question is settlement/reconciliation, not acceptance. Deposit/no-show policy, messaging provider and consent still need decisions before P1-03/P1-04.                                                                                                                 |

Detailed rationale and evidence limits are preserved in `PROJECT.md`. Documentation
audits marked Done did not resolve these product decisions or defects.

## External completion notices

Inform only; never edit the PDF or external task system. Based on preserved Done
evidence (not new product verification in this documentation task), these IDs were
already recorded complete and can be marked done externally if not already marked:

- TK2610-0004 / P0-07 — developer-copy cleanup.
- TK2610-0006 / P0-08 — localisation.
- TK2610-0007 / P0-03 — business hours.
- TK2610-0014 / P1-09 — performer-picker cleanup.

TK2610-0008 / P0-05 was signed off Done by the user on October 19, 2026 (UAT
accepted) and is already marked done externally. TK2610-0009 / P0-01,
TK2610-0010 / P0-02, TK2610-0011 / P0-04 and TK2610-0012 / P0-06 passed the user's
UAT check on October 19, 2026; mark them done externally if not already. TK2610-0010
was accepted on an **email-only** scope — WhatsApp e-receipt moves to TK2610-0021.
TK2610-0013 and Phase 1 (TK2610-0001) are ready to mark Done externally: on
October 19, 2026 the user explicitly confirmed P0 is done and ready, following the
milestone review and disclosed limits. No external task system was changed.
This approval does not sign off Phase 2 or final launch readiness.

## Recent handoffs

### October 19, 2026 — TK2610-0017 ADR 0020 continuation

- Finished voucher preview/apply/remove, tender retotaling and code submission.
  Checkout blocks during preview; payment state remounts when cart/customer changes.
- Added manager refund dialog with explicit stock choice and external-money notice.
  Browser and email receipts disclose vouchers/refunds and voucher-adjusted lines.
- Added shared/service/route/browser regressions. Refund retries are idempotent
  under contention, point reversal is append-only, and refund/void share a sale lock.
- Verified API 358/358, web 411/411, shared 99/99; root build, workspace typecheck
  and lint pass. Migration status reports 18 migrations, database up to date.
- Original ADR 0020 absent; added a clearly labeled reconstructed implementation
  record under docs. L2 allocation formula/columns remain deferred; earning still
  uses catalogue points × quantity. Refund debt/holding/report accounting needs
  policy. No browser UAT, commit, deploy, reset or reseed in this continuation.
- Task remains IN PROGRESS. Next: resolve L2 and refund accounting limits in ADR
  0020 before production acceptance; do not start TK2610-0018.

### October 19, 2026 — TK2610-0017 authorized browser bug-fix slice

- User chose verified held-cart/cache/receipt fixes first; vouchers, tips, refunds
  and loyalty changes remain blocked pending explicit policy.
- Added backward-compatible optional resumed hold ID to tenant/user browser draft;
  restored on page remount, cleared on completion/leave/discard. Re-parking a
  resumed cart no longer creates another held row. Existing server hold is not
  edited by Leave it held; local edits are still discarded by that explicit action.
- Rebuilt held line pre-discount preview from stored unit price and line discount
  divided by quantity; avoids applying the saved rate twice, including 100% off.
  Still a historical quote, not a guarantee of current catalogue price.
- Shared cache invalidation refreshes customer views (including holdings/history),
  reports and dashboard after completion/void without clearing another open cart
  on void. Voided receipt preserves paid history, suppresses active debt/change
  and explicitly says money refunds are handled separately.
- Web suite 408/408 across 46 files; web typecheck/lint exit 0. Added reload/hold,
  10%/100% discount, storage isolation, cache invalidation and voided short tender
  regressions. Fixed missing holdings fixture. Initial reload test needed to await
  async cart hydration; corrected and reran full suite. No weakened assertions.
- No schema/API changes, DB operations, browser UAT, commit or deployment. API
  tests not rerun for browser-only changes. Retry idempotency, complete held listing,
  current catalogue preview, backend reversal races/retention and financial policy
  remain; TK2610-0017 stays BLOCKED, not externally Done.

### October 19, 2026 — TK2610-0016 accepted; TK2610-0017 POS audit (BLOCKED)

- User confirmed customer profile UAT acceptance and authorized POS continuation.
  Marked TK2610-0016 DONE; no external tracker changed.
- Inspected source DOCX POS requirements, ADRs 0015–0017, Prisma sale models,
  shared sales contracts, sale service, POS screen/hooks, draft storage, receipt
  and test names. Existing discounts, terminal voids and desktop two-column cart
  do not satisfy missing vouchers/tips/barcode/refunds.
- Confirmed component-only resumed hold ID, no hold-create idempotency key,
  limit-only listing, narrow void cache refresh and voided Outstanding label.
  Catalogue points remain unchanged by discounts, conflicting with ADR 0017.
- Focused Vitest output: Sale 25/25 and draft storage 3/3, with undefined holdings
  query mock warning; terminal wrapper closed without confirming exit status.
  No API DB tests, browser walkthrough, database commands or application edits.
- Await explicit policy for loyalty formula, voucher scope, tip allocation/tax
  and refund scope/accounting. Do not silently equate void with refund or invent
  tax policy. Preserve all existing uncommitted work; do not start TK2610-0018.

### October 19, 2026 — Authorized development database reset and demo seed

- User confirmed local `glampro_suite` and standing permission to reset/reseed this
  development database whenever needed. Saved the bounded permission in PROJECT;
  production and other databases are not covered. Existing application work preserved.
- Verified local database/port, created custom-format backup and checked its archive
  listing: `backups/glampro_suite_pre_reset_2026-10-19T06-43-38.597Z.dump`.
  Archive listing was checked, not a restore rehearsal. Backup remains gitignored.
- Initial reset was blocked by Prisma's AI safety gate before data changes. User
  freshly confirmed the exact reset; rerun with that consent succeeded. Ran shared
  build/client generation, `npm run db:reset`, development `npm run db:seed`, and
  migration status. All exited 0; all 17 migrations applied; live schema diff empty.
- Fresh demo: 1 tenant, 6 users, 10 customers, 13 appointments, 10 sales; seed reports
  3 branches, 42 shifts, 12 services, 12 products, 2 packages, 1 value package and
  2 gift cards. Zero privacy notices, consent events and photos. No implicit consent;
  configure tenant notice and grant customer data consent to exercise photo uploads.
- Reset deliberately replaced prior development data and invalidated prior sessions;
  sign in again. No production access, commit or deployment. No full test-suite rerun
  or browser walkthrough in this operational follow-up. Prior implementation test
  results remain historical. TK2610-0016 rollout complete; browser/visual UAT remains.

### October 19, 2026 — TK2610-0016 customer profile implementation (IN PROGRESS)

- Added `/customers/:id`, linked from customer names, with contact/branch details,
  existing editable notes and consent, active holdings, paginated past appointments
  and completed/void purchase history. Future bookings/held carts excluded; statuses
  stay visible. Currency uses major-unit `formatPrice`, not cent-based `formatMoney`.
- Added tenant-scoped CustomerPhoto and additive migration
  `20261019130000_customer_photos`. Bytes live in PostgreSQL, not public `/uploads`.
  Authenticated tenant photo list/read; writable tenant upload/delete; upload requires
  current data consent, checked/locked in the insert transaction. Reads are no-store.
  JPEG/PNG signature checks, 5 MB cap, caption limit, explicit deletion confirmation.
  Original metadata remains; no transcoding, automatic purge or legal-compliance claim.
- Normalized shared request contracts, customer service and demo seed email writes:
  trim/lowercase, blank to NULL, tenant uniqueness and case-insensitive duplicate
  precheck. No existing-email rewrite/merge; existing collision audit still required
  before any future normalization migration. No importer/admin customer writer exists.
- Verified: API **351/351**, zero skipped, on a newly initialized local-only disposable
  PostgreSQL 18 cluster at port 55439; web **404/404** across 46 files; shared **96/96**.
  Root production build, typecheck and workspace lint pass. All 17 migrations deploy
  from empty disposable DB; Prisma datasource-to-schema diff empty. Root format check
  still reports four unchanged API files (auth routes, catalogue route tests, auth
  service, settings service). No clean aggregate verify claim.
- New tests cover tenant/unauthenticated photo/history denial, consent withdrawal,
  suspended photo writes, private byte retrieval, malformed format refusal, deletion,
  history pagination/filtering, money scaling, profile editor/read-only UI, upload
  error handling and email normalization/tenant uniqueness. Existing tests retained.
- Remaining: normal local migration rollout and browser/visual walkthrough (customer
  name → profile; notes edit/reload; history pages; balances; grant data consent;
  upload/view/delete a photo; withdraw consent and verify upload refusal). No salon
  DB migration/reset/seed, outbound messages, commit, deployment or external update.
  TK2610-0016 is not ready to mark Done externally. Resume it before TK2610-0017.

### October 19, 2026 — TK2610-0015 local migration and UAT closeout (DONE)

- User explicitly accepted UAT and requested migration. Working tree clean at
  start; reviewed the only pending migration, `20261019120000_customer_consent`.
- Confirmed target is local PostgreSQL `localhost:5432`, database `glampro_suite`.
  Custom-format pre-migration backup created and `pg_restore --list` verified:
  `backups/glampro_suite_pre_consent_2026-10-19T06-01-54-775Z.dump` (gitignored).
  Initial version-specific pg_dump attempt failed; migration was stopped until
  system pg_dump successfully produced the verified archive. No restore test run.
- `npm run db:migrate` applied only the reviewed additive consent migration,
  exit 0. `npm run db:migrate:status`: all 16 applied, exit 0. Live datasource-to-
  schema Prisma diff: no difference, exit 0. No reset, seed or data rewrite.
- Read-only before/after checks: existing row counts unchanged across 36 tables;
  10 customers, all consent false/revision zero; zero notices and consent events.
  No invented notice wording or implicit opt-in. No messages sent.
- No application edits or service restart; full suites were not rerun against the
  existing database. Prior disposable-DB API 347/347, web 399/399, shared 95/95
  remain implementation evidence; this closeout verifies migration, not browser UI.
- TK2610-0015 ready to mark Done externally; user manages external tracker.
  Next ready task: TK2610-0016 / P1-05 Customer profile page; not started here.

### October 19, 2026 — TK2610-0015 implementation (IN PROGRESS; local rollout/UAT remaining)

- User accepted tenant-configured wording/version with grants disabled until
  configured. Managers publish immutable versions in Settings; no supplied default
  legal text or automatic opt-in. Ordinary customer creation/edit does not change
  consent; save a new customer, reopen Edit, and use the separate consent controls.
- Added shared consent contracts/tests, PrivacyNotice and CustomerConsentEvent
  models, default-false customer fields and additive migration
  `20261019120000_customer_consent`. Both new models are tenant-scoped.
- Customer editor shows current wording, separate data/optional marketing choices,
  presentation acknowledgement, paginated history and reload/error states. Grants
  require the current notice; withdrawals remain possible without it. Data-consent
  withdrawal also clears marketing. No signature/self-service proof is implied:
  this is staff-recorded consent with server time and staff id.
- Consent changes and audit events commit atomically; expected revisions prevent
  lost withdrawals/concurrent overwrite. Published wording cannot be edited or
  reused; old wording remains linked in audit history. Staff ids survive deletion.
  Evidence follows customer/tenant deletion; no automatic retention purge exists.
- Added `requireMarketingConsent` for future dispatch consumers and tested refusal
  before opt-in/after withdrawal. No promotional sender currently exists, so no
  real marketing-delivery enforcement is claimed. Receipts and staff 2FA unchanged.
- Verification: disposable PostgreSQL 18 cluster under
  `/tmp/glampro-consent-pg.yHoeDa`, loopback port 55439, new `consent_test` and
  `consent_shadow` databases only. All migrations deploy; DB-to-schema diff empty.
  API 347/347 with 0 skipped, web 399/399 across 45 files, shared 95/95 pass.
  Root build, typecheck and lint exit 0. Tests cover HTTP roles/auth/read-only,
  tenant isolation, strict validation, notice versioning, stale grants, withdrawals,
  actor/time/history, concurrency, default choices and UI permission/error states.
- Root format check still fails on the same four unrelated API files recorded in
  the milestone review; no clean aggregate verify claim. Scoped formatting and
  `git diff --check` pass. Initial test failures (strict notice serialization and
  missing test-fixture module category) fixed and full suites rerun successfully.
- Existing salon database untouched: no reset, seed or migration applied there.
  No outgoing mail, deployment, commit, external status change or browser visual
  check. Existing low-stock/report changes preserved.
- Remaining: apply the reviewed migration through the normal local workflow,
  restart API, then UAT: before configuration grants disabled; publish approved
  separate texts/version as manager; create/edit customer; grant data only then
  marketing; reload; withdraw data and verify both false plus audit history; verify
  staff cannot publish notices. Keep task IN PROGRESS until rollout/UAT is accepted.
- Disposable cluster stopped after verification; its temporary files remain for
  inspection. No existing PostgreSQL instance was stopped or modified.
- Next after completion: TK2610-0016 / P1-05 customer profile page. Do not start it yet.

### October 19, 2026 — TK2610-0015 / P1-06 consent audit (BLOCKED)

- Inspected Customer Prisma model, shared create/update/response contracts,
  customer service/routes and tests, editor and screen tests, tenant context,
  email transport and callers, and the source DOCX requirement.
- No customer consent fields/history exist. Customer writes currently allow
  authenticated tenant members when writable; consent permissions need an explicit
  choice rather than a silent role-policy change. No marketing sender exists;
  current senders are transactional receipt email and staff 2FA.
- DOCX supplies the feature name, not approved privacy-notice text, evidence
  retention or withdrawal policy. Asked the user to choose a technical baseline
  versus providing approved policy before implementation.
- Proposed, not approved: separate data and marketing choices; no automatic opt-in;
  server timestamp, actor and notice version for grants/withdrawals; current-consent
  checks for future marketing consumers; transactional receipts kept separate.
  No automatic deletion or claim of legal compliance is inferred.
- No application edits, database commands, messages sent, or external task changes.
  Application tests were not rerun for this policy-only audit. Existing low-stock
  and report changes remain untouched. Resume this task after the policy decision;
  do not advance to another tracked task.

### October 19, 2026 — TK2610-0013 / P0 readiness review (DONE)

- Reviewed TASKS: TK2610-0004–0012 cover all nine P0 requirements and are recorded
  Done. The user previously accepted live Packages/Gift cards and the GST,
  receipt, payment and reports slices. Those earlier acceptances alone did not
  approve this milestone; October 20 is the original target, not automatic approval.
  The user subsequently explicitly confirmed "yes it's done and ready. please
  continue" on October 19, closing this milestone and the P0 phase gate with the
  disclosed limits retained. Specific walkthrough scenarios were not reported.
- Fresh checks: root `npm run build`, `npm run typecheck` and `npm run lint` exit 0; web 43 files /
  392 tests, shared 92 tests, and pure `prisma/seed-data.test.ts` 13 tests pass.
  The dataset checks cover references, clash windows, totals, tender arithmetic
  and stock, not live demo freshness or a repeat-run database seed.
- Root `format:check` reports the same four unchanged files:
  `apps/api/src/routes/auth.routes.ts`, `apps/api/src/routes/catalogue.routes.test.ts`,
  `apps/api/src/services/auth.service.ts`, `apps/api/src/services/settings.service.ts`.
  No clean aggregate `verify` claim. No unrelated formatting or application edits.
- Handoff checks: Prettier on TASKS/PROGRESS and `git diff --check` pass.
- No database reset, seed, migration, existing-data change, external task update,
  commit or deployment. Database-backed API tests were not rerun because this
  session has not established a disposable test database. The prior 339/339
  result is retained as historical evidence, not a fresh regression result.
- Seed inspection confirms demo grants for packages, giftCards and reports, but
  seed code does not establish today's live data. No live browser or email
  delivery verification was performed in this review.

#### Sales-demo walkthrough / explicit approval checklist

Use the intended demo tenant and synthetic customer data. Do not reset/reseed an
existing database merely to make the dashboard look fresh.

1. Log in with the intended demo role; confirm the correct salon, friendly copy,
   S$ amounts, DD/MM/YYYY dates, saved salon timezone and business hours.
2. Show populated Products/Services/Packages/Gift cards and available Reports.
   With an unentitled test tenant, confirm add-on Add controls are hidden and API
   refusal is friendly. Do not change a live tenant's entitlements for the demo.
3. Ring a service/product sale with a customer and performer; show the accepted
   GST setting and tax line. Record a local tender and a package/credit redemption
   using a suitable existing holding; verify the remaining balance and receipt.
4. Show receipt numbering and the email-receipt flow. Verify delivery only with
   an approved recipient and configured transport; UI success is not proof of
   inbox delivery. WhatsApp receipts are deferred to TK2610-0021.
5. Reconcile that sale with the salon-day Z-report and staff/service totals; show
   collected versus redeemed amounts and the liability snapshot. If demonstrating
   void, explain that ledger reversal is not a provider refund.
6. Review desktop/mobile presentation and any observed defects. Confirm the demo
   dataset is useful on the presentation date; relative seed dates do not refresh
   themselves. Record any waiver rather than treating untested steps as passed.

Demo limits: local rails are recorded tenders, not PSP processing/settlement;
package liability is sessions, not a monetary valuation; commission is reporting,
not the P1-08 rules engine; reports have no export/scheduled delivery yet. Known
P1 booking, held-sale and reversal findings remain in the unresolved section and
are not cleared by this milestone review.

- Result: user readiness approval recorded; TK2610-0013 and TK2610-0001 are DONE.
  Verification limitations and known P1 findings remain unchanged; sign-off does
  not turn unperformed checks into passing results or approve final launch.
- Next: TK2610-0015 / P1-06 PDPA consent and marketing opt-in (P1-09 is already
  Done). Not started in this milestone closeout, per the one-task handoff rule.

### October 19, 2026 — TK2610-0012 / P0-06 reports (DONE)

- Found `18c973f feat(reports): add Z-report, liability, and commission reporting` already
  committed, while the tracker still said "Not assessed". Audited it against the completion
  check instead of rebuilding it.
- Z-report: `salonDayBounds` gives the salon-local `[from, to)` day; voids come from
  `voidedAt` inside that day, so a sale rung up yesterday and voided today appears today;
  `collected` and `redeemed` are split by `isRedemptionPaymentMethod`; tax is the
  snapshotted `Sale.taxAmount`. Test fixtures assert the void (999.00) and outstanding
  (10.00) figures.
- Overview: staff rows fold `EmployeePerformance` plus `EmployeeCommission` (sale-linked
  or created in range for period commissions); services, items, days and tenders are
  folded from completed sales only; liability excludes expired and exhausted holdings
  and reports package sessions as a count.
- ADR 0010 closed in `apps/api/src/services/catalogue.service.ts`: `listProducts` keeps
  `filterThreshold` for `?lowStock=true` and uses `badgeThreshold` (the stored tenant
  threshold unless there is no override) for `toProduct`. `catalogue.service.test.ts`
  now asserts both rows of the override-widened page — `Aloha Shampoo` stays
  `lowStock: false` at 10 units where the salon threshold is 5.
- Checks run: API 339/339, web 392/392 across 43 files, API typecheck/ESLint/scoped
  Prettier, web typecheck — all exit 0. Reports screen tests 5/5 and reports endpoint
  tests 6/6.
- Two over-long lines in the committed `report.service.ts` also failed Prettier; they
  were re-wrapped (whitespace only). `format:check` still fails on the four files this
  task never touched, as recorded under TK2610-0011.
- Not committed: the ADR 0010 fix and its test, plus the `report.service.ts` re-wrap. Suggested commits: `fix: keep low-stock badges on the salon threshold when filtering (TK2610-0012)` and `style: format report service`.
- UAT (October 19, 2026): user reported UAT complete on `/reports`; no defects were reported and the exact scenarios exercised were not recorded. The task is now DONE locally; mark it done in the external system if not already.
- Next: TK2610-0013 — MILESTONE: P0 UAT and sales-demo readiness sign-off.

### October 19, 2026 — TK2610-0011 / P0-04 local payment methods + redemption (DONE, implementation)

- Decision (ADR 0019): local rails are **manually recorded** tenders, not a PSP integration.
  PayNow and SGQR share `PAYNOW_SGQR`; `NETS`, `GRABPAY` and `ATOME` have their own codes.
  A redemption is a **tender** (`PACKAGE`, `PREPAID_CREDIT`), never a discount, so totals,
  points and stylist credit stay what the catalogue says.
- Credit is **fungible** (user's answer): prepaid credit pays for any line up to its balance.
  A package covers only the services it lists, in cart order, one session per service unit.
- **Server-side draw.** `redeemPayments()` runs inside the sale transaction: re-reads the
  holding, recomputes coverage (`HOLDING_NOT_COVERED` when the amount disagrees), decreases
  with a `>=` guard (`HOLDING_INSUFFICIENT` on a race), and writes one `CustomerRedemption`
  naming the holding. `HOLDING_NOT_FOUND` (404), `HOLDING_EXPIRED` (409),
  `HOLDING_REQUIRES_CUSTOMER` / `REDEMPTION_EXCEEDS_TOTAL` (400). `reverseForVoid()` restores
  the sessions/credit and stamps `revertedAt` instead of deleting.
- **Schema.** `PaymentMethod` gained six values; `CustomerRedemption.holdingId` + index added
  by additive migration `20261019034125_local_payment_methods_and_redemption_holding`
  (applied locally, no reset).
- **API.** `GET /api/customers/:id/holdings` merges the two ledgers into one list of spendable
  rows (expired/exhausted omitted), each naming the tender that spends it.
- **Web.** Payment sheet offers all eleven tenders; a redemption row picks the holding and
  shows the amount read-only, computed by the same rule as the server. Receipt badges and the
  email receipt name every tender.
- Verification: `prisma migrate status` up to date (DB↔schema diff empty); API typecheck/ESLint/Prettier
  clean; web typecheck and production build pass; API 333/333 (6 new sale-service tests + 5 in the new
  `customers.routes.test.ts`) and web 391/391 across 43 files pass. No browser/E2E automation; the user's
  manual UAT covered the flow.
- User UAT (October 19, 2026): reported complete. The exact scenarios the user exercised were not
  recorded here; no defects were reported back.
- Committed as `c2274bc` with the suggested message.
- Next: TK2610-0012 / P0-06 reports.

### October 19, 2026 — TK2610-0011 / P0-04 UAT sign-off (DONE)

- User confirmed UAT complete on the till. Local payment methods and package/prepaid-credit redemption
  are accepted on the **manually recorded** scope in ADR 0019: no PSP, QR payload, webhook or settlement.
- Local tracker promoted to fully DONE. External task/PDF updates stay with the user.
- Note for the next session: `npm run format:check` fails on four files this task never touched
  (`auth.routes.ts`, `catalogue.routes.test.ts`, `auth.service.ts`, `settings.service.ts`) — pre-existing
  Prettier drift, deliberately left alone.

### October 19, 2026 — TK2610-0010 / P0-02 receipt UAT sign-off (DONE)

- User completed UAT and accepted an **email-only** scope. WhatsApp e-receipt is not
  implemented and moves to TK2610-0021 (P1-04), which still needs a provider, template
  and consent decision. No WhatsApp code was invented.
- **GST snapshot:** `Sale.gstRegistrationNumber` is written by `resolveCart` only while
  the salon's GST is enabled; additive migration
  `20261019120000_sale_gst_registration_number` applied to `glampro_suite`. Reprints keep
  the old number when the setting changes. Historical rows with tax fall back to the
  current salon number; zero-tax rows print none.
- **Email:** `receipt-email.service.ts` builds HTML + text from the stored `SaleDetail`
  (same source as the paper), escaping salon/line copy. `POST /:id/receipt/email` sits
  behind session auth, `requireModule("sales")`, `requireWritableTenant()` and a
  30/15min limiter; 409 for HELD carts, 503 on provider/configuration failure. Dev/test
  use nodemailer's JSON transport; production 503s when SMTP is unset. Sends are
  synchronous — no outbox, retry or delivery confirmation.
- **Web:** `useEmailSaleReceipt` mutation and `EmailReceiptDialog` (prefilled customer
  address, shared-schema validation, stays open with the destination after a send).
- Verification: migration applied; API typecheck + ESLint + Prettier clean; API 322/322 and web
  387/387 pass (new: `sales.routes.test.ts` 5, `receipt-email.service.test.ts` 5). The
  production build was not run this session.
- Changes uncommitted; suggested message
  `feat: snapshot GST number and email sale receipts (TK2610-0010)`.
- Next: TK2610-0011 / P0-04 local payment methods.

### October 19, 2026 — TK2610-0009 / P0-01 GST UAT sign-off (DONE)

- User completed the UAT check (GST settings, sale receipt, report figures) and the
  local tracker is promoted to DONE. External system/PDF updates stay with the user.
- Policy: Singapore GST 9%, inclusive of catalogue prices. Back-calculated per line
  (`lineTotal × 9 / 109`, half-up 2dp); sale tax is the sum of rounded lines. Rate and
  amount are stored on `Sale`/`SaleLine`. GST defaults off, so existing salons are
  unaffected.
- Shipped: shared constants/schemas, additive migration
  `20261019015129_gst_settings_and_sale_tax`, settings service pair guard (`gstEnabled`
  requires a number; a stored number survives a toggle-only PATCH), sale pricing and
  receipt mapping, report tax aggregation, Settings toggle + registration number,
  ReceiptView "Includes GST (9%)" row, Reports GST column and totals tile.
- Verification: migration applied; `build:shared`, shared/API/web typecheck and lint
  exit 0; shared 92/92, web 387/387, API 312/312 pass.
- Changes are uncommitted; suggested message
  `feat: add inclusive GST settings, receipts and reports (TK2610-0009)`.
- Next: TK2610-0010 / P0-02 receipts (thermal print + email/WhatsApp e-receipt with the
  GST number).

### October 19, 2026 — TK2610-0008 / P0-05 UAT sign-off (DONE)

- User confirmed UAT acceptance and marked TK2610-0008 Done in the external system;
  local tracker promoted Ready for UAT to DONE. External system/PDF updates stay
  with the user.
- Correction: the P0-05 `Products.tsx`/test changes previously recorded as
  uncommitted are committed in `80bd83b` (checked with `git log -- Products.tsx`).
- Tracker-only update; no code, tests or database touched this session.
- Next: TK2610-0009 / P0-01 GST settings, tax line on sales & tax reports.

### October 18, 2026 — SETUP-05 database environment (DONE)

- Verified environment: PostgreSQL on `localhost:5432` (only 5432 listening; the
  commented-out `SHADOW_DATABASE_URL` in `apps/api/.env` targets stale port 5433),
  db `glampro_suite`, shadow `glampro_shadow`, `.env` never committed to git.
- Two drift sources repaired, all additive via `npm run db:migrate`, no
  reset/reseed: applied pending `20261015210000_tenant_localisation` and
  `20261016151623_tenant_operating_hours` (live DB was missing `tenants.time_zone`
  / `locale` and `tenant_operating_hours` despite `_prisma_migrations` rows), then
  generated and applied `20261018141510_user_two_factor_auth` for P0-09's 2FA
  columns that existed only in `schema.prisma`.
- Backup before changes: `backups/glampro_suite_2026-10-18.dump` (pg_dump, ~125KB);
  `backups/` added to `.gitignore`.
- One pre-existing test failure surfaced once seed ran: the replay case in
  `apps/api/src/routes/auth.routes.test.ts` still asserted pre-P0-09 family
  revocation. Test updated to ADR 0007 behavior (replay 401 `SESSION_INVALIDATED`;
  rotated pair stays valid). Test-only — `auth.service.ts` unchanged.
- Checks: `prisma migrate status` → 12 migrations, up to date, 0 rolled back;
  `prisma migrate diff` live-DB↔schema and migrations↔schema both "No difference
  detected" (exit 0); API tests 308/308 pass (exit 0). Web/shared not rerun (not
  touched this session). Uncommitted work preserved; no commit/push.

### October 17, 2026 — DOCS-01 three-document migration (DONE)

- Corrected the initial partial consolidation to the clarified scope: only
  PROJECT/TASKS/PROGRESS are maintained project documents. No extra rule file or
  separate decision/design docs. Delivered design assets/README remain unchanged.
- Consolidated ADR 0002–0018 policies, rationale, tradeoffs, code references and
  evidence limits into PROJECT; Design 1–7 retains frame/token/icon/route/checklist
  and primitive-delta details. Workflow is in PROJECT; external notices restored.
- Added missing email, migration, login-layout and cancelled-booking findings.
  Product statuses stay unchanged. Source changes are reference comments only;
  verify token equivalence and preservation of existing uncommitted work.
- Verification: 29 PDF IDs, 24 exact DOCX task requirements and 37 prior statuses
  preserved. All 17 decision IDs and seven design sections have stable destinations;
  retired links removed and active PROJECT links/anchors resolve. Removed 20
  superseded files; docs now contains only DOCX/PDF. Delivered design README stays
  unchanged as an asset, not an additional maintained project document.
- All 66 edited source/schema files have equivalent non-comment contents (TS/TSX
  parse/printed AST comparison, CSS/Prisma comment-stripped comparison). All 287
  other snapshot files are unchanged, including original documents, design assets,
  existing Prisma tenant-scope fix and Products test changes.
- Checks run: web Login/Products/Card/navigation — 4 files, 56/56 tests passed;
  shared catalogue/sales — 53/53 tests passed; scoped Prettier and git diff --check
  passed. No full build/typecheck/API tests or database commands: application edits
  in this task are comments only. No commit/push. Test scripts and safety snapshots
  are outside the repository, not new management documents.

### October 17, 2026 — TK2610-0008 / P0-05 (historical)

- Recorded audit: package/gift-card CRUD, entitlement guards, demo seed grants and
  templates exist. Web Add button now hides for unentitled add-on tabs; read-only
  behavior remains disabled rather than hidden.
- Changed `apps/web/src/pages/Products.tsx` and its test file (still uncommitted).
- Recorded results: web 383/383 tests, web typecheck/lint/build passed. API 308/308
  and shared 87/87 were reused from the earlier baseline, not rerun in this slice.
- Status remains Ready for UAT; live demo entitlement/data verification is not
  established by reading the seed configuration alone.

### October 17, 2026 — SETUP-02 baseline (historical)

- Recorded isolated disposable PostgreSQL 18 migration deploys; no seed/reset or
  existing database use. Temporary cluster stopped after checks.
- Recorded API 308/308, web 381/381, shared 87/87, workspace lint/typecheck passing.
- Added `TenantOperatingHours` to tenant-scoped Prisma models; change remains in
  `apps/api/src/lib/prisma.ts` and is outside this documentation task.
- Full root verify was NOT clean: seven pre-existing formatting failures were
  reported. The old tracker overstated aggregate success. Individual passing
  checks above do not establish a successful `npm run verify`.

### October 17, 2026 — SETUP-06/07/08 decision reviews (historical)

- Recorded evidence reviews for ADRs 0002/0003/0006/0008 in commit `257eead`.
  Decision context is now consolidated in PROJECT. Open findings remain unresolved.

### October 22, 2026 — P2 completion evidence correction

- Supersedes the earlier Phase 3 closure note: no explicit P2 sign-off established.
  October 21 launch approval excluded P2; P0/P1 historical acceptance is preserved.
- TK2610-0003 is IN PROGRESS; TK2610-0026 is BLOCKED. No grant submission
  acknowledgement or prepared application pack established. Earlier official-source
  verification and September PSG/EDGE transition claims withdrawn as unsupported.
- Other P2 child statuses are historical records, not freshly verified workflow
  acceptance. Preserve rebrand's accepted code-only scope and external-clearance risk.
- Current root build and typecheck both exit 0. Root lint exits 1:
  apps/api/src/services/treatment.service.ts:174 no-explicit-any; web/shared lint pass.
  Fresh checks supersede earlier syntax-failure reports, not functional tests.
- AI assistant inspection: default owner summary has no daily date filter and promo
  response has no approval flag. Requires focused follow-up before accepting 0029.
- SEC-01 remains BLOCKED; its separate-resource approval requirement is unchanged.
  No database tests, migrations, seeding, mail, deployment or application edits.
