# CP-003 configuration acceptance

## Scope and authority

The October 28, 2026 approved Option 2 separates configuration acceptance from
historical monetary impact. This review covers CP-003 only. CP-003A retains
authoritative historical inputs and preview/full-run equality after CP-004/CP-005;
it remains required before CP-007 release acceptance.

Configuration acceptance is not payroll activation or production readiness.
Historical readiness must stay `UNAVAILABLE` with `impact: null` while monetary
evidence is missing. Sample-input calculators are not historical payout previews.

## Acceptance evidence map

Paths below are relative to
`/home/tuangpi/Documents/Aridient/Glampros/glampro_suite`.

| Check                                                                                        | Existing verification                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema and migration replay on disposable PostgreSQL only                                    | API Prisma migrations; fresh database migration replay in this review                                                                                   |
| Plan create/save/publish/duplicate/archive; immutable published versions and audit           | `apps/api/src/services/payroll-configuration.acceptance.test.ts`; `apps/web/src/components/settings/PayrollPlans.test.tsx`; real Chrome lifecycle cases |
| Tenant isolation, owner writes, manager read-only configuration and salary redaction         | Configuration service/HTTP acceptance and Chrome role-denial/salary cases                                                                               |
| Required classification/join date/plan, atomic staff creation, rollback and recovery         | Configuration acceptance; `apps/api/src/services/payroll-lifecycle-concurrency.acceptance.test.ts`; staff routes/UI tests and Chrome creation cases     |
| Assignment overlap, month-end selection, outlet scope and immutable scope history            | Configuration acceptance; shared engine/pooling tests; scoped assignment UI and Chrome cases                                                            |
| Tiers/stages/incentives, exact money, sample definitions, calculator/chart/comparison        | Shared commission-payroll engine/settings tests; web definition editor, plan and comparison tests; configuration HTTP calculator equality               |
| Revision conflicts, publication/assignment/staff races, explicit stale-form reload           | Configuration and lifecycle concurrency acceptance; plan/settings form tests; Chrome stale settings cases                                               |
| Audited salary/settings writes and locked-period guards                                      | Configuration acceptance; settings form tests; Chrome salary reason, audit and redaction cases                                                          |
| Fail-closed historical readiness, authorization/context/revision changes and request failure | Historical input tests; configuration HTTP checks; `PayrollHistoricalPreview.test.tsx`; Chrome readiness cases                                          |
| No earnings activation or monetary writes from configuration/readiness                       | Service returns `earningsActive: false`; Chrome verifies unchanged earnings/collection counts and read-only preview audit behavior                      |

## Current review

- Status: **ACCEPTED — October 28, 2026**, configuration-only scope. Verification used a new
  disposable PostgreSQL 18 instance on loopback port 55474, database
  `payroll_configuration_test`; all 58 migrations replayed successfully.
- Root production build, workspace typechecks and workspace lint passed.
- Shared tests: **252/252 passed**.
- Full serial API tests with CP-003 acceptance enabled: **638 passed, 35 gated
  skips, zero failures**. Includes configuration service/HTTP acceptance and all
  five lifecycle race cases. Unrelated opt-in suites remain gated, not accepted.
- Real Chrome/API configuration and readiness suite: **18/18 passed twice**
  (seventeen child cases plus parent on each run).
- Full web regression with one worker: **910/910 passed across 106 files**.
- Verification runner exited 0; disposable PostgreSQL stopped cleanly. Missing
  `xclip`/`xsel` clipboard helpers and pg queued-query deprecation messages were
  non-failing warnings; no assertions or checks were disabled to obtain a pass.
- Verification logs: `/tmp/cp003-config-review-LobY2h/` contains `results`,
  `build.log`, `migrate.log`, `typecheck.log`, `lint.log`, `shared.log`, `api.log`,
  `browser.log`, `browser-repeat.log` and `web.log`.
- The application database, production migrations, backfill and earnings activation
  are not part of this review. Existing uncommitted application changes are preserved.

## Explicit limits

- Browser coverage is the seventeen documented cases in BROWSER_ACCEPTANCE.md,
  not every possible UI interaction or request interleaving. It uses synthetic
  authenticated sessions, not login/2FA/refresh acceptance.
- Tests use synthetic disposable tenants. They do not establish authoritative
  historical financial evidence or accept CP-003A/TC-25 historical integration.
- Actual payouts, frozen monthly statements, capture/cutover, performance release
  gates and deployment remain the responsibilities of later tracked tasks.
