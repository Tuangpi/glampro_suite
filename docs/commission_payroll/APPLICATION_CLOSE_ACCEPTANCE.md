# CP-005 application close integration and final-gate review

## November 2, 2026 status

**M4 DONE. M5 IN PROGRESS, not final release acceptance.** M1–M4 are accepted.
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

## M5 remaining gates — do not mark complete yet

1. Extend mounted browser acceptance to manager draft calculation/adjustment,
   stale-source refusal/recalculation and
   opening/settlement actions. Existing service/HTTP/component tests cover these
   individually; that is not equivalent to their complete mounted browser flows.
2. Review the final money matrix against the newly mounted response contracts,
   including plan/component and manual adjustment explanations, not just selected
   assertions or demo inputs. Preserve approved snapshots and audit counts.
3. Broaden documented monthly performance beyond one flat-plan/50 receipts to
   representative active plan/stage/band/source volume. MTD <500 ms remains a
   CP-006/CP-007 requirement because the MTD endpoint is not part of this close
   integration. Do not report the monthly timing as MTD acceptance.
4. Run the final focused and broad checks after the remaining acceptance work,
   then record M5's exact scope. CP-003A historical full-run equality, CP-006
   exports/reports/MTD/self-service UI and CP-007 release/cutover gates remain
   separate; mounting close does not complete them or authorize production writes.

The disposable PostgreSQL cluster was shut down after verification.

No schema/migration/dependency changes, real provider operations, deployment,
commit or push were performed.
