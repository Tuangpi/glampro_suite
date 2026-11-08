# CP-005 application close integration and final-gate review

## November 2, 2026 status

**M1–M5 DONE for local CP-005 acceptance, not final release acceptance.**
The application now mounts the close router and Settings → Payroll close screen.
This is local integration, not deployment, legacy earnings cutover, real payment
execution or activation of another commission posting path.

### Application and permission contract

- Authenticated `/api/payroll-close/:period` reads the persisted snapshot; GET
  never calculates. POST `calculate` accepts only `expectedRevision`.
- POST `adjustments` accepts the revision and a reasoned adjustment, never an actor.
  Actor identity comes from authenticated tenant context. Recalculation preserves
  adjustments; changed/stale revisions refuse without partial state or audit.
- Owner-only POST `approve` accepts revision/reason, reloads authoritative inputs
  and freezes outputs. POST `payout` is a separate owner-only revision/reason/
  reference confirmation; it never transfers funds or creates payment rows.
- Owner-only GET `carry`, POST `opening` and POST `settlements` retain existing
  complete-inventory, balance-hash, scope, evidence and revision guards.
- Managers calculate and adjust, but response projections omit salary, fixed
  overtime, levy, take-home and salary-derived percentages. Managers receive
  commission, incentive, collection and calculation breakdowns. Raw loader inputs,
  profiles and source/configuration inventories are omitted from all close views.
- GET `statement` is own-data only for owner/manager/staff and exposes commission
  details, not salary profiles. Cashiers are refused at router, store and frozen
  state boundaries. GET `statements/:staffId` is owner-only and omits raw inputs.
- Settings uses the existing authenticated client and query cache. Staff/cashiers
  do not mount/fetch the close workspace. Suspended tenant UI is read-only and the
  server refuses writes. Branch sessions must explicitly select All outlets;
  direct outlet-scoped payroll requests still refuse. Switching outlet reloads
  the app and removes cached payroll state.
- The screen shows draft/frozen status and revision, exact decimal output,
  departed staff, expandable commission results, reasoned actions and a separate
  actual payout reference. Failed reads hide old results; retry recovers.

### Executed acceptance and regressions

| Check                                                                                                                                                                                           | Result / evidence                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Mounted real HTTP, 50 staff / 50 real cash receipts, real default loader; adjustments, stale refusal, approval, self-data/redaction, suspended writes, payout, audit and zero earnings creation | 14/14 including lifecycle, frozen-state and response-projection tests; `/tmp/m4-http-acceptance.{log,exit}`           |
| Real Chrome, Vite, createApp, PostgreSQL; owner adjustment/approval/payout, manager redaction/direct write refusal, network failure/retry, outlet refusal, staff/cashier denial                 | 8/8 including parent and 7 browser subcases; `/tmp/m4-browser.{log,exit}`                                             |
| Full API, bounded concurrency 3, disposable DB                                                                                                                                                  | 1,386 tests: 1,130 passed, 0 failed/cancelled, 256 explicit opt-in skips; `/tmp/m45-api-verified.{log,exit}`          |
| Full web, bounded workers 2                                                                                                                                                                     | 981/981 across 111 files; `/tmp/m45-web-verified.{log,exit}`                                                          |
| Enabled CP-005 payroll carry/source/lifecycle/default-loader/authorization/race acceptance                                                                                                      | 204 tests: 201 passed, 0 failed/cancelled, 3 separately gated CP004 lifecycle skips; `/tmp/m45-regression.{log,exit}` |
| API/web types, full API/web lint, shared/API/web builds                                                                                                                                         | Pass; `/tmp/m45-quality.{log,exit}`                                                                                   |

The ordinary API run's skips are not substitute acceptance. The explicitly enabled
201-case run and separate real browser/HTTP runs supply the scoped evidence above.
Final shared rerun: **305/305**, `/tmp/m45-shared.{log,exit}`. Final focused
HTTP/state/store/projection/refund regression: **76/76**,
`/tmp/m45-final-focused.{log,exit}`. Final quality recheck after all code changes:
`/tmp/m45-final-quality.{log,exit}`.

Earlier full runs exposed two refund HTTP mocks lacking the M2 payroll-close
inventory delegate and a sales-route fixture deleting immutable receipt economics.
Mocks now model empty close inventory; sales-route tests use fresh tenant/email
identities and retain original receipts. No triggers, constraints or assertions
were disabled. Earlier parallel web tests hit 5-second timeouts under CPU load;
the complete bounded-worker rerun passes without increasing test timeouts. Chrome
cleanup initially raced profile writes; it now waits for child exit before removal.

### Measured monthly calculation

- Dataset: 50 synthetic staff, each with one real completed SGD 100 cash service
  receipt, four-decimal collection evidence, synthetic historical salary and
  published flat 10% service plan assignments, complete approved zero opening. There are 50
  source receipts, not fabricated loader output. Commission reconciles to 10.00/staff; manual addition is exactly 12.30, with target take-home 2,022.30.
- Timed segment: actual authenticated manager HTTP `calculate`, including real
  transaction, authorization, default DB loader, snapshot/audit persistence and
  response projection: **1,154.2 ms**, below 10 seconds. Fixture setup excluded.
- Environment: Linux 7.0.0-42-generic x86_64; Intel Core i5-13420H, 12 logical
  CPUs; Node 24.21.0; PostgreSQL 18.6, UTC; loopback API/DB. Other validation jobs
  were running. This is one bounded synthetic dataset, not a throughput benchmark,
  complex-plan scale test, production sizing claim or measured MTD endpoint.
- Only verified disposable `127.0.0.1:55485/payroll_close_test`, directory
  `/tmp/cp005-m3-apyc3kkj`, was written. Historical configuration time is controlled
  during fixture setup only; browser and HTTP transitions use the real clock.

## M5 final local acceptance — November 2, 2026

The four former M5 remainder gates are closed within CP-005's supported scope.
The M4 counts/timing above are historical evidence, not the expanded M5 results.

### Mounted browser flows

`payroll-close-browser.acceptance.test.ts`: **10/10**, no failures/skips,
`/tmp/m5-final-browser.{log,exit}`. Real Chrome, Vite, createApp and PostgreSQL;
no mocked responses. Manager calculates, adds a reasoned adjustment and recalculates
without salary/take-home or owner carry/approval controls. A further real historical
checkout changes source receipts after calculation: owner approval refuses, persisted
close and audit count are byte-for-byte unchanged, manager recalculates and the
owner sees commission rise by exactly 10.00 while the 12.30 adjustment survives
(take-home 2,032.30). Only historical checkout setup uses a controlled Date; browser
actions use the real clock.

Owner approval freezes results; separate payout confirmation creates no new tender.
Read failure hides cached salary and retry restores the frozen result. Branch scope,
staff/cashier denial and manager direct owner-write denial remain covered.

A separate tenant exercises **future December 2026** opening authorization at the
real November 2 clock. An incomplete inventory refuses with zero authorization
rows. Complete opening includes all staff/zeros and component debt -25.1234 with
-1.0000 units; the owner explicitly writes off that component. Reauthorizing opening
to -30.5678 makes the old disposition stale; mounted owner review/reauthorization
repairs it. Four immutable authorization rows retain owner/reason and revisions
1/2 per kind; there are no close-transition events or earnings in this tenant.
The September approved tenant retains its six close events.

### Final money-matrix review

Review basis: REQUIREMENTS.md acceptance cases, DECISIONS.md, the M1 supported
lifecycle matrix/final review, M2 correction acceptance and M3 carry/plan-switch
acceptance in CLOSE_ACCEPTANCE.md. The new mounted contract matrix supplements,
not replaces, those real-writer and pure-engine suites. It does not claim CP-007
release-level TC acceptance or CP-003A historical full-run equality.

`routes/payroll-close-matrix.acceptance.test.ts`: **1/1**, no failures/skips,
`/tmp/m5-final-focused.{log,exit}`. Independent hand-computed expectations, not a
second call to the implementation under test:

| At SGD 2,000 base / 20 units per staff | Senior | New starter |
| -------------------------------------- | ------ | ----------- |
| Flat 10%                               | 200.00 | 200.00      |
| Whole tier                             | 240.00 | 160.00      |
| Slice tier                             | 165.00 | 110.00      |
| Mixed whole/slice tier                 | 180.00 | 120.00      |
| Fixed 3.25 per unit                    | 65.00  | 65.00       |

Every one of 50 statements checks method, active tenure stage, exact four-decimal
base/units, two-decimal component amount and working explanation. Each plan also
has a 50%-base 1% component capped at 7.50 and a two-level salon-cash incentive
awarding 50.00. Actual collection stays 2,000.0000, independent of commission bases.
Manager outputs omit salary-derived fields and raw inputs.

All five manual adjustment kinds are posted by the manager and preserve authenticated
actor and reasons. Owner matrix: 2,000 salary + 207.50 plan commission - 5.50 manual
commission adjustment + 50 incentive + 20.20 overtime + 30.30 addition - 10.10 unpaid
leave - 4.40 deduction = **2,288.00 take-home**. Levy 100 is excluded from take-home
but included in payroll/sales **119.40%**; the alert is true. Frozen reads retain the
calculation hash; attempted recalculation refuses without adding to the **10** audit
events. Payments remain 1,000, earnings remain zero.

| Retained money family                                                                         | Acceptance / mounted-contract conclusion                                                                                                                                     |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary, GST, splits, FOC, session/value package sale/redemption, instalments, refunds/voids | M1 authoritative source suites retain exact independent cash/base reconciliation and missing-evidence refusals; projection exposes earned results, never loader inventories. |
| Approved-month corrections and operational cash                                               | M2 lifecycle/session suites retain actual occurrence and next-open commission posting separately; frozen prior history is unchanged.                                         |
| Negative base/units, fallback debt, mapping/write-off and plan/version changes                | M3 real-writer suite retains four-/ten-decimal debt and source-time economics; mounted owner carry flow now covers authorization and stale repair.                           |
| Methods, stages, caps, incentives and manual adjustments                                      | Expanded mounted HTTP matrix above checks all five methods, both stages, independent expected money, explanations, actor/reason and frozen/audit invariants.                 |
| Historical missing economics, spent/transferred purchase voids, partial returns               | Accepted policy refusals remain; no new policy exception or inferred history was introduced.                                                                                 |

### Representative monthly timing

- 50 staff, **1,000 real completed cash service receipts** (20 per staff), **5 active
  published plan versions**, **10 plan components**, two active tenure cohorts,
  three bands per tier component, stage-rate overrides, caps and salon-cash incentives.
  Each plan has 10 assigned staff, five in each cohort. Real assignment/publication,
  checkout and default loader are used; salary/history fixtures are synthetic.
- Three successive authenticated manager calculations, including transaction,
  default DB loading, calculation, snapshot/audit writes, response projection and
  response read: optimized samples **7,163.3 / 8,029.9 / 7,927.9 ms**, all below
  **10 seconds**, `/tmp/m5-matrix-optimized.{log,exit}`. Final focused rerun samples
  **7,265.8 / 8,057.3 / 8,086.4 ms** (`/tmp/m5-final-focused2.{log,exit}`) are
  recorded in PROGRESS.md. Setup excluded; local environment as documented above. This is a
  bounded monthly sample, not a production sizing, maximum-plan or throughput claim.
- MTD **<500 ms remains unaccepted** under CP-006/CP-007; no MTD endpoint was measured.

Earlier expanded-cohort samples passed at 6.74–7.74 seconds, but rechecks failed
at 15,608.6 ms with overlapping API jobs and 13,654.5 ms in isolation. The 10-second
assertion was not relaxed. The loader queried each receipt's sale and complete
collection history independently. It now batches complete tenant/sale histories
and reuses loaded sales; prior instalments, deterministic receipt order, cumulative
exact-cent tax replay and independent monthly inventories remain intact. A new
regression verifies query shape and missing-history refusal. This is not a general
throughput or maximum-volume guarantee.

### Scope and final verification

Final enabled payroll regression and broad API, web/shared, lint, typecheck, build
and formatting evidence are recorded in the latest PROGRESS.md checkpoint.
Initial empty-action settlement fixture and later malformed test-title edit were
rejected by validation; corrected fixtures/syntax passed reruns. No policy guard,
assertion or database constraint was disabled.

CP-003A historical full-run equality, CP-006 exports/reports/MTD/self-service UI and
CP-007 release/cutover remain separately gated. CP-005 completion does not authorize
production writes, activation, provider payments or deployment.

The disposable PostgreSQL cluster was shut down after verification.

No schema/migration/dependency changes, real provider operations, deployment,
commit or push were performed.
