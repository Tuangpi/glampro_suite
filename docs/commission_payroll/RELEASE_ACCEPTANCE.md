# CP-007 release verification, reconciliation and cutover acceptance

## November 4, 2026 status

**CP-007 DONE for local release acceptance; nothing here authorizes production
activation.** Every figure below was produced on disposable loopback PostgreSQL
clusters with synthetic tenants, then torn down. No production database, host,
deployment, payment execution or legacy-ledger rewrite happened, and none is
authorized by this document. Migration, deployment and activation against
production still require separate explicit authorization.

One measurement in this record is environment-limited and is **accepted as such**
rather than left open: NFR-03's month-to-date budget is met with ~1.7× headroom on a
host at nominal CPU clock, and the same unchanged code breaches the per-sample
500 ms budget on the machine these final runs happened to execute on, after it
rebooted into a power-saving governor (400–1,100 MHz). The budget, the code and the
dataset are unchanged; only the host's clock was. The owner accepted that evidence
on November 4, 2026, with re-measurement on the target host folded into the runbook's
pre-activation verification instead of being treated as unfinished CP-007 work.

What CP-007 adds on top of the accepted modules is the **switch**: plan payroll
becomes the payroll of record for a salon at an owner-attested month, and can be
rolled back without touching a single historic row. The operator procedure is
`CUTOVER_RUNBOOK.md`; this file is the acceptance record.

### Cutover guarantees that were verified

- The cutover is prospective by construction
  (`apps/api/src/services/payroll-cutover.ts`). Activation never rewrites,
  recalculates or backfills an `employee_commissions` row and never re-opens a
  closed month; from `effectivePeriodKey` onwards `sale.service.ts` skips the
  legacy accrual writer, and rollback resumes it. Proven end to end on real
  PostgreSQL through the mounted HTTP routes by
  `payroll-cutover.acceptance.test.ts` ("CP-007 cutover stops legacy accrual at
  the attested month and rollback resumes it", 1,462 ms in the enabled run).
- Activation is an owner attestation over a **specific** inventory hash. The hash
  is `sha256` over the whole classification and is window-specific, so a salon
  that reviewed twelve months cannot activate against a hash computed for
  twenty-four; a moved window is refused with
  `PAYROLL_CUTOVER_INVENTORY_STALE` plus the fresh hash instead of being covered
  silently (`payroll-cutover-inventory.test.ts`, 8 cases).
- `BLOCKER` inventory issues refuse activation (legacy payout inside a covered
  month, unpaid earning no plan can re-derive, outstanding clawback, activation
  month before the current one, plan payroll approved at or after the rollback
  month); `WARNING` issues proceed but are frozen into the attested inventory, so
  the activating owner has acknowledged them.
- The event chain stays append-only and alternating: triggers refuse event edits
  and deletes, identity or revision changes, and status transitions that do not
  alternate. Rollback is itself an audited event, and re-activation continues the
  same chain.
- Rollback is refused while plan payroll is approved for an unsettled month, so a
  salon cannot drop back to the legacy writer on top of an unpaid approved close.
- Reads are not a second source of truth: `GET /api/payroll-cutover` and
  `GET /api/payroll-cutover/inventory` are read-only, re-verify the chain on every
  read, and a dry run (`effectivePeriodKey` supplied) classifies months without
  activating anything.

### NFR evidence

| NFR    | Requirement                                                                         | Evidence                                                                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-01 | Decimal strings, four-decimal bases, two-decimal half-up totals, no monetary floats | `packages/shared/src/commission-payroll/*.test.ts`; `payroll-export-data.test.ts` ("frozen model keeps statement money and totals that reconcile to the cent"); close snapshot hashes are computed over canonical strings |
| NFR-02 | Asia/Singapore default local month, half-open boundaries, date-edge tests           | `payroll-correction-period.test.ts` ("timezone boundary and year rollover use salon-local calendar months"); the release performance run executes with a UTC server and an Asia/Singapore salon month                     |
| NFR-03 | 50 staff/month < 10 s and MTD < 500 ms, dataset and environment documented          | `payroll-release.performance.test.ts`; met with ~1.7× headroom at nominal CPU clock, breached on the current power-limited host — both measured in the section below                                                      |
| NFR-04 | Approved bases/results/audits and complete statements cannot mutate                 | append-only triggers in the close and cutover migrations; `payroll-close-store.acceptance.test.ts`; `payroll-progress.acceptance.test.ts` ("CP-006 progress refuses a snapshot its audit row no longer covers")           |
| NFR-05 | Tenant isolation, configurable outlet plan/group scope, cross-scope tests           | `payroll-close-authorizations.acceptance.test.ts`; "outlet-scoped close reads refuse rather than exposing salon-wide payroll"; cutover tenant/isolation cases                                                             |
| NFR-06 | Role guards, own-data reads, export/salary restrictions, verified PIN exceptions    | `payroll-close.acceptance.test.ts`; "cashiers cannot read even their own payroll statement"; "frozen exports are owner-only"; `payroll-package-lifecycle.acceptance.test.ts` (manager PIN exception)                      |
| NFR-07 | Every TC case covered at an engine, API or UI layer, not only demo unit tests       | the TC matrix below; no row is evidenced by a demonstration fixture or seed sample alone                                                                                                                                  |

### TC-01–TC-25 matrix

Layers: **E** = shared calculation engine, **A** = API service on real
PostgreSQL, **H** = mounted HTTP, **U** = web UI. Every case is executed, not
asserted by inspection.

| Case  | Required result                                                                                | Executed evidence                                                                                                                                                                                                                                           | Layer |
| ----- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| TC-01 | Hair base 6,830 → 546.40                                                                       | `commission-payroll/engine.test.ts` — "TC-01 Hair cash + package whole-tier 6830 → 546.40"                                                                                                                                                                  | E/H   |
| TC-02 | On course whole 8,985.50 → 628.99                                                              | `engine.test.ts` — "TC-02 and TC-03 On course whole 628.99 vs slice 488.99"                                                                                                                                                                                 | E/H   |
| TC-03 | Same base by slice → 488.99                                                                    | same case as TC-02                                                                                                                                                                                                                                          | E/H   |
| TC-04 | Bases 4,000 / 4,000.01 / 6,000 / 6,000.01 → 0 / 160 / 240 / 480                                | `engine.test.ts` — "TC-04 exact boundaries and one four-decimal tick above"                                                                                                                                                                                 | E     |
| TC-05 | Join September 10, October month 2; base 3,600 → 144                                           | `engine.test.ts` — "TC-05/06 joined September 10 gives October new and December standard"                                                                                                                                                                   | E/A   |
| TC-06 | Same staff December month 4; base 3,600 → 0                                                    | same case as TC-05                                                                                                                                                                                                                                          | E/A   |
| TC-07 | Historical TP package sales-value base 9,256.31 → 647.94                                       | `engine.test.ts` — "TC-07 historical TP sales-value package base 9256.31 → 647.94"                                                                                                                                                                          | E     |
| TC-08 | Individual metric 10,421.31 → incentive 50; 9,853 → 0                                          | `engine.test.ts` — "TC-08 highest target row is noncumulative and is based on exact thresholds"                                                                                                                                                             | E     |
| TC-10 | Third 1,000 session blocked after paying 2,000; verified manager PIN exception audited         | `payroll-package-lifecycle.acceptance.test.ts` — refuses a missing/invalid manager PIN, then audits the approved exception; `payroll-package-session.test.ts`                                                                                               | A     |
| TC-11 | Catalogue edit leaves original holding/session economics unchanged                             | `payroll-close-loader.acceptance.test.ts` — immutable FOC list-price economics captured at checkout while member/list prices differ; `package-expiry.test.ts` — a catalogue rule change neither shortens nor extends an existing snapshot                   | A     |
| TC-12 | Refund 2,900 → sale bases -1,450 each; redemption retained                                     | `payroll-session-races.acceptance.test.ts` (same TC09/12 case) and `prepaid-refund-settlement.acceptance.test.ts`                                                                                                                                           | A     |
| TC-13 | Negative component base -500 → commission 0 and carry -500                                     | `engine.test.ts` — "negative base TC-13 carries or writes off explicitly, then offsets next month's pool"                                                                                                                                                   | E/A   |
| TC-14 | Version effective January 1, 2027 does not alter December 2026                                 | `engine.test.ts` — "TC-14/15 selects last-day assignment and version, ignores drafts, rejects ambiguity"                                                                                                                                                    | E/A   |
| TC-15 | Assignment changed November 15 applies to whole November under the last-day rule               | same case as TC-14                                                                                                                                                                                                                                          | E/A   |
| TC-16 | Transferred holding: performer earns original-value redemption; sellers keep the sale base     | `payroll-package-lifecycle.acceptance.test.ts` — `transferSessionPackage` on real rows, original economics retained; `payroll-session-races.acceptance.test.ts` — "refund versus transfer never cancels recipient credit using stale owner evidence"        | A     |
| TC-17 | Value package pays 500 for 600 credit: sale base 500, spend 100 → base 83.3333 (83.33 display) | `engine.test.ts` — "TC-17 cumulative value-package ratio absorbs final residual"; `payroll-close-value-loader.acceptance.test.ts`                                                                                                                           | E/A   |
| TC-18 | Missing required Sold by blocks checkout                                                       | `payroll-session-races.acceptance.test.ts` — "TC18 required seller policy refuses checkout with no persisted sale" (asserts the sale count does not move)                                                                                                   | A     |
| TC-19 | Correct September session after approval: September unchanged; reverse/repost next open month  | `payroll-correction-period.test.ts` — "TC-19 allocation preserves approved September and selects open October"; `payroll-correction-posting.test.ts`; `payroll-close-inventory.test.ts`                                                                     | E/A/H |
| TC-20 | Excel totals equal frozen on-screen statements to the cent; PDF also verified                  | `payroll-export-render.test.ts` — "summary totals are frozen numbers that match the approved statement"; `payroll-export-data.test.ts`; `payroll-close.http.test.ts` — "approved close downloads a workbook, payslips and a filtered ledger as attachments" | H/U   |
| TC-21 | Hair mixed base 12,000 → 1,000                                                                 | `engine.test.ts` — "TC-21 same 12000 input gives whole 1200 / slice 600 / mixed 1000"                                                                                                                                                                       | E     |
| TC-22 | Cap 500 on computed 628.99 → 500 with explanation                                              | `engine.test.ts` — "TC-22 cap is applied after calculation and is explained"                                                                                                                                                                                | E/H   |
| TC-23 | On course switch effective January 2027; impact delta -140 for the same inputs                 | `engine.test.ts` — "TC-23/25 impact preview equals a full draft run and delta is -140"                                                                                                                                                                      | E/A   |
| TC-24 | Decreasing band limits block publication                                                       | `engine.test.ts` — "TC-24 decreasing bands fail validation; seed plans pass with whole-tier warnings"                                                                                                                                                       | E/A   |
| TC-25 | Impact preview equals a full run with identical inputs and proposed rules                      | same case as TC-23, plus `payroll-historical-preview.acceptance.test.ts` — "CP-003A historical preview money equals posted monthly payroll money"                                                                                                           | E/A/H |

Additional policy fixtures (Alvin FOC full list 492 → 1,187.69; Stella collected
package base 8,688 → 1,931.84 with 0 incentive) remain CP-002 engine fixtures and
are deliberately **not** presented as reconciliation of delivered salary figures.

### Reconciliation against delivered salary figures

The twelve-month historical reconciliation is the last part of CP-005/CP-007
that cannot be closed here, and it is not claimed. It needs the salon's real
exported payroll for the covered months to compare against a preview run, and
that data has never been in this repository: `apps/api/scripts/payroll-preview.ts`
is built to run it (dry run by default, `--commit` to persist) and
`docs/commission_payroll/REQUIREMENTS.md` records the acceptance criterion, but
executing it against real months and signing off the differences is an
owner/accountant act on real data.

What is verified instead is that the preview machinery produces the same money as
the posted monthly payroll for the same inputs
(`payroll-historical-preview.acceptance.test.ts`), so the reconciliation is a
data-entry exercise rather than an unmade product decision.

### Cutover acceptance checklist

The runbook is the procedure; this is the record of what each step was exercised
against end to end on the disposable cluster (mounted HTTP, real PostgreSQL, real
audit chain).

| Runbook step                              | Exercised by                                                                                                                                                   | Result                                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 1 — read the current state           | `GET /api/payroll-cutover` with no activation, then with an activation and after rollback                                                                      | returns the chain-verified state; a tampered event row is refused (`PAYROLL_CUTOVER_HISTORY_INVALID`)                                                     |
| Step 2 — dry-run the inventory            | `GET /api/payroll-cutover/inventory?effectivePeriodKey=…` repeatedly (read-only route)                                                                         | identical, stable `inventoryHash` for the same window; no rows written                                                                                    |
| Step 3 — resolve blockers, then re-review | the `BLOCKER` fixtures (legacy payout in a covered month, unpayable earning, outstanding clawback, month ordering, approved rollback month)                    | each refuses with its own code; `WARNING` fixtures activate and are frozen into the attested inventory                                                    |
| Step 4 — activate                         | `POST /api/payroll-cutover/activate` with the reviewed hash, then with a hash from a different window                                                          | succeeds only against the exact reviewed hash; otherwise `PAYROLL_CUTOVER_INVENTORY_STALE` + fresh hash                                                   |
| Step 5 — verify the switch                | post-activation sale through the mounted sale route, then monthly payroll                                                                                      | no new `employee_commissions` row for the switched month; the per-line snapshot the plan reads is still written, so the plan has its own inputs           |
| Rollback                                  | `POST /api/payroll-cutover/rollback` with required reason, then a sale                                                                                         | legacy accrual resumes; re-activation continues the same event chain                                                                                      |
| Rollback refused while approved           | rollback attempt with an approved, unsettled plan-payroll month, then the same attempt once its payout is confirmed                                            | refused with `PAYROLL_CUTOVER_ROLLBACK_BLOCKED` and the offending `periodKeys`, activation unchanged; the refusal lifts only after the payout is recorded |
| Closing the first switched month          | not exercised by a cutover-specific suite — the close/export/tamper paths are proven independently by the CP-005 close matrix and the frozen-row trigger cases | the switch changes only which writer records earnings, so a switched month closes on exactly the evidence those suites already cover                      |

### Automated verification

Every count below comes from a completed run on this machine, not from an
expectation. The API has two tiers: the default suite (opt-in gates off) is the
regression gate, and the gated payroll acceptance set is executed on a disposable
cluster with the gates named by each file.

| Suite                                                | Command (in `apps/api`, unless noted)                                                                                                                                                                                   | Result                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| shared engine and money helpers                      | `npm test` in `packages/shared`                                                                                                                                                                                         | 305 passed, 0 failed (9.0 s)                                                           |
| API regression, opt-in gates off                     | `node --import tsx --test` over the default set                                                                                                                                                                         | 1,486 tests / 98 suites — 1,211 passed, 275 skipped, **0 failed** (61.9 s)             |
| API payroll acceptance, gates on, timing files alone | `node --import tsx --test --test-concurrency=1` over `payroll-close-matrix.acceptance.test.ts` and `payroll-release.performance.test.ts` with `RUN_CP005_ACCEPTANCE`, `RUN_CP007_PERFORMANCE`                           | 2 tests — 1 passed, **1 failed** (month-to-date budget; see the host-clock note below) |
| API payroll acceptance, gates on, everything else    | `node --import tsx --test --test-concurrency=1` over `payroll-*.test.ts` (services and routes) and `prepaid-refund-*` with `RUN_CP005_ACCEPTANCE`, `RUN_CP003A_PREVIEW_ACCEPTANCE`, `CP006_PROGRESS_DB=1`               | 786 tests — 777 passed, 9 skipped, **0 failed** (602 s)                                |
| CP-004 lifecycle chain on its own cluster            | `COMMISSION_COLLECTION_ACCEPTANCE=1` over `src/services/payroll-package-lifecycle.acceptance.test.ts`, `src/services/payroll-session-races.acceptance.test.ts`, `src/services/payroll-close-package-redemption.test.ts` | 41 tests — 41 passed, **0 failed** (6.7 s)                                             |
| web application                                      | `npx vitest run --maxWorkers=2` in `apps/web`                                                                                                                                                                           | 116 files / 1,016 tests passed, 0 failed (134 s)                                       |

Two invocations, not one: the two files that assert wall-clock budgets run on their own
first, and the rest of the payroll set runs after them. In a single 14-minute invocation
those samples absorb whatever the preceding 786 tests left in the machine, which is how
the earlier "aged database" figures (7,427 / 8,003 ms and 414.6–460.3 ms) were produced:
re-running the same two files alone on the _same_ accumulated database reproduces
3,996–4,659 ms and 259–291 ms. Data age was never the variable; run-tail load was.

Skipped counts are opt-in gates whose target cluster was not the one under test
(for example the browser-driven CP-003A case, which needs a live Vite server, and
the CP-004 chain when the gates above are not set). No skipped test is counted as
evidence in the matrix.

Running the whole API set with **every** gate on at once is not a valid
configuration: several suites pin their own disposable host, port and database
name, and a foreign cluster makes them fail on `url.port` before any assertion
about behaviour. The gated payroll set above is the configuration where every
payroll acceptance file runs against the cluster it was written for. Three further
observations from that exercise, all environment rather than product:

- Sequential execution is the only mode in which the two wall-clock assertions mean
  anything, and even then they must not run at the tail of a long set (see the
  two-invocation note above).
- `SC003_CORRECTION_HTTP_TEST` / `SC003_POLICY_TEST` (opt-in, off by default) are
  stale: the correction/void HTTP fixture redeems unpaid sessions without the
  manager approval that `payroll-package-session.ts` has required since 2026-10-30
  (commit `8c1ac04`), so it fails with `PACKAGE_UNPAID_SESSIONS` on a healthy
  system. The policy suite passes. This predates CP-007, is skipped in the default
  regression, and is recorded here rather than silently repaired.
- **The host's CPU governor decides the last 2×.** The machine that ran these
  measurements rebooted mid-session and came up in `powersave` at 400–1,100 MHz
  (Intel i5-13420H, nominally boosting to ~4.6 GHz), with no passwordless `sudo`
  available to change it. Throughput roughly halved: the month close went from
  3,996–4,659 ms to 7,162–9,595 ms and the month-to-date read from 259–291 ms to
  415–559 ms. The close stays inside its 10 s budget on the slow host; the
  month-to-date read does not stay inside 500 ms per sample (medians 461–497 ms,
  with 2, 3 and 5 of ten samples over budget in the three runs). No product code
  differed between the two hosts.

### NFR-03 measured

`payroll-release.performance.test.ts` drives the mounted HTTP close and the
month-to-date read over a synthetic salon (50 staff, five plans, 1,000 real
receipts across September 2026, salon time zone Asia/Singapore, server UTC,
disposable PostgreSQL 18 on loopback with `fsync` off). Setup and one warm-up call
are excluded; the warm-up is reported separately as `monthToDateWarmUpMs` so a
cold first call can never be mistaken for steady-state behaviour, and the
assertions run after all samples are collected. The acceptance fixture ends with
`ANALYZE` so the planner has the statistics a database in service would have;
without it the first assertion on a freshly migrated database measures a
first-touch plan.

| Host state                                                 | Month close              | Month-to-date (10 samples)            | Budget        |
| ---------------------------------------------------------- | ------------------------ | ------------------------------------- | ------------- |
| Nominal clock, fresh database (earlier session)            | 3,794 / 4,347 ms         | 255.3 – 282.4 ms (warm-up 264 ms)     | 10 s / 500 ms |
| Nominal clock, same accumulated database, executed alone   | 3,996 – 4,659 ms         | 259 – 291 ms                          | 10 s / 500 ms |
| `powersave` at 1.1 GHz, run 1 (before the fixture ANALYZE) | 8,602 / 9,595 / 8,489 ms | 459.3 – 559.5 ms, 5 of 10 over 500 ms | 10 s / 500 ms |
| `powersave` at 1.1 GHz, run 2                              | 7,645 / 9,045 / 8,483 ms | 432.3 – 517.7 ms, 2 of 10 over 500 ms | 10 s / 500 ms |
| `powersave` at 1.1 GHz, run 3 (nothing else running)       | 7,162 / 8,055 / 7,779 ms | 415.6 – 540.8 ms, 3 of 10 over 500 ms | 10 s / 500 ms |

The first two rows are the code's cost and are inside both budgets with ~1.7×
headroom on the month-to-date read. The last three are the same code on a host
running at roughly a quarter of its nominal clock and are **not** inside the
month-to-date budget, so this environment cannot be used to claim NFR-03 either
way. Two consequences are recorded rather than smoothed over: the month close has
less headroom than it looks (it consumed 72–96% of its 10 s budget on the slow
host), and the month-to-date budget is per-sample, so a 2× slower host breaches it
even though the median read stays under 500 ms.

**Accepted, not deferred.** NFR-03 stands on the first two rows: the budget is a
property of the read path, and the read path did not change between the two host
states — the fixture dataset, the sample count, the warm-up exclusion and the
assertion are identical. Loosening the assertion to a median would hide exactly the
per-request guarantee the requirement asks for, so it was left alone. Instead, the
target-host measurement is a pre-activation step in `CUTOVER_RUNBOOK.md` (Step 5),
where the hardware that will actually run payroll is the hardware that gets
measured. Until then this record states plainly that the per-sample month-to-date
budget was not reproduced on the power-limited host on November 4, 2026.

The decisive change for the month-to-date budget was in
`apps/api/src/services/payroll-close-store.ts`: the month-to-date read no longer
re-reads and re-hashes the ~1.4 MB close audit payload to prove the stored
progress snapshot. It proves the snapshot against the audited `stateHash` instead
(`verifiedPayrollCloseSnapshot`), while the close path keeps full verification.
Event-payload tampering is still refused in every place the payload is returned or
acted upon, which is why the lean read could not become a tamper hole: the
acceptance case "CP-006 progress refuses a snapshot its audit row no longer
covers" passes on both the lean and the full path.

### Deliberate scope decisions

- **The switch is salon-wide, not per outlet.** `PayrollCutover` is keyed by
  `tenantId` and unique per tenant. Plan payroll itself is outlet-scoped through
  plan scope and group rules, but the decision to stop the legacy writer is one
  decision per salon. A multi-outlet salon switches all of its outlets at the same
  attested month; splitting that would mean two payrolls of record inside one
  tenant, which is the ambiguity the cutover exists to remove.
- **Activation cannot backdate.** `effectivePeriodKey` may not be earlier than the
  month of activation. Backfilling a past month is a different, audited product
  action (correction/repost), not a cutover.
- **Rollback is not history erasure.** The cutover row and the whole event chain
  stay; rollback adds an event and flips the status. Re-activation continues the
  same chain rather than starting a second one.

### Defect found and fixed while gathering the evidence

Writing down the rollback precondition ("no approved month that has not been paid
out") exposed that `rollbackPayrollCutover` implemented only half of it: it refused
on **any** `APPROVED` close at or after the current month, without checking whether
that month's payout had been confirmed. Payout confirmation keeps `status =
APPROVED` and records `state.payout` (the status check only ever allows `OPEN`,
`CALCULATED`, `APPROVED`), so a salon that had approved _and paid_ the current month
could never roll back — its only recovery path out of a wrong plan was closed
permanently, while the refusal message told the owner to settle the month it had
already settled.

The guard now filters on the payout, matching the message and the double-pay
rationale: a paid month's frozen snapshot will never pay those sales again, so
resuming legacy accrual cannot pay a sale twice. The new acceptance case "CP-007
rollback is refused while plan payroll is approved for an unsettled month" pins both
directions on real HTTP and real PostgreSQL — refused with
`PAYROLL_CUTOVER_ROLLBACK_BLOCKED` and `details.periodKeys` while the payout is
missing (activation unchanged, no event appended), and the same rollback succeeding
once the payout is recorded.

A second defect surfaced while rebuilding the environment for this record, in the
release gate itself rather than in payroll: the first default-suite run on a freshly
migrated database failed two `requireModule` assertions with `200 !== 403`
("refuses an add-on the tenant has not bought", "refuses an add-on whose entitlement
has lapsed"). The guard was correct — `commission-collection-evidence.acceptance.
test.ts` upserts the shared `packages` catalogue row as `isCore: true` with
`update: {}`, so on a new database whichever parallel file creates that row first
decides whether `packages` is a core module or an add-on, and `requireModule.test.ts`
had inherited a core row. That file now states the core-ness it depends on
(`update: { isCore }`) instead of leaving the row to whoever wrote it first; it
passes with the row forced to `isCore = true` beforehand and normalises it back. Two
further default-suite runs were green (1,486 tests, 1,211 passed, 0 failed, 275
skipped).

### Known limitations

- **Real-month reconciliation is still open.** See the section above: it needs the
  salon's exported payroll, which has never been in this repository. This is the
  one CP-005/CP-007 acceptance item that cannot be closed by writing code.
- **The performance figures are local, synthetic and unpessimistic about
  hardware.** They prove the budgets are met by this implementation, not that a
  given production host will meet them. Measure on the target host before
  activation: the runbook's Step 5 verification is the natural place.
- **The month close has less headroom than the month-to-date read** (7.2–9.6 s of a
  10 s budget on a host running at a quarter clock; 4.0–4.7 s at nominal clock). Any
  future addition of per-receipt work inside the close path should be measured against
  this row on the target host, not against a fast developer machine.
- **The opt-in SC-003 correction/void HTTP suite is stale** (see the verification
  section). It does not affect the default regression, but it cannot be cited as
  evidence until its fixture supplies the manager approval that the package
  session rule has required since 2026-10-30.
- **The web suite needs bounded workers on a small machine.** With four suites
  competing, `vitest` exceeded its timeouts in `PayrollPlans` and
  `payroll-close*` component tests; every one of them passes in isolation and in
  the `--maxWorkers=2` run (116/116 files, 1,016/1,016 tests). This is CPU
  contention, not a product defect, and it is the reason the recorded web command
  carries `--maxWorkers=2`.

### Authorization

CP-007 is complete as **local acceptance of a readiness capability**. It does not
authorize, and none of the runs above performed: a production migration, a
deployment, a payroll payout, an activation against a real salon, or any change to
production data. Those steps need explicit human authorization and the runbook
followed by a named owner.

| TC-09 | October deposit 2,000 split 50/50 → 1,000 each; November balance 3,000 → 1,500 each | `payroll-session-races.acceptance.test.ts` — "TC09/12 deposit and balance split, original session economics and refund -1450 each" | A |
