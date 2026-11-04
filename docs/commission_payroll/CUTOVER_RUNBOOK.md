# CP-007 payroll cutover runbook

## Purpose and authority

This is the operator procedure for switching a salon from the legacy commission
ledger to plan payroll as the **payroll of record**, and the procedure for
reversing that switch. It describes only behaviour that exists in the code
(`apps/api/src/services/payroll-cutover.ts`,
`apps/api/src/services/payroll-cutover-inventory.ts`,
`apps/api/src/routes/payroll-cutover.routes.ts`, migration
`20261104120000_payroll_cutover`).

The cutover is **prospective by construction**. It does not rewrite, recalculate or
backfill a single `employee_commissions` row, and it never re-opens a closed month.
From `effectivePeriodKey` onwards the plan is the payroll of record and the legacy
accrual writer skips new rows; every month before it stays exactly as recorded.
There is no "migrate history" step in this runbook, because the implementation has
none and none is needed: a closed month is history, not a draft.

Running this procedure against production requires separate explicit authorization.
Nothing in CP-007 acceptance authorizes a production activation.

## Preconditions

- Migrations through `20261104120000_payroll_cutover` are applied; both
  `payroll_cutovers` and `payroll_cutover_events` exist with their append-only
  triggers.
- The acting account is a **verified owner** (`SUPER_ADMIN`) with 2FA enabled. The
  service re-reads role and 2FA from the database inside the transaction, so a stale
  browser session or a forged token cannot perform the write. Manager and staff
  writes are refused with 403.
- The tenant is write-enabled. All three writes are guarded by
  `requireWritableTenant`; a read-only salon cannot activate or roll back.
- The salon has reviewed its legacy ledger for the window it is about to attest.
  Activation is an owner attestation over a **specific** inventory hash, not a
  promise to review later.

## Step 1 — Read the current state

`GET /api/payroll-cutover` (owner or management; reads are not owner-limited)

Expect `status: "NOT_ACTIVATED"`, `revision: 0`, `history: []` on a salon that has
never switched. `NOT_ACTIVATED` is the absence of a row, not a stored status, so it
is a normal answer on the first visit, not an error.

## Step 2 — Dry-run the inventory

`GET /api/payroll-cutover/inventory?months=12&effectivePeriodKey=2026-11`

`months` is 1–24 and the window always **ends with the current salon month**;
`effectivePeriodKey` is the candidate first month of plan payroll. Passing it makes
the response `proposed: true` and classifies those months as `covered` for review
purposes — it does not activate anything.

Read every row of `months` and every entry of `issues`:

| Verdict        | Meaning                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RELIABLE`     | every recorded legacy row is traceable. Unpaid traceable rows are superseded by plan payroll, which re-derives the same sale from its own inputs. |
| `INCOMPLETE`   | a row cannot be traced to a sale, or a refund clawback is still outstanding.                                                                      |
| `ALREADY_PAID` | legacy money already left for that month.                                                                                                         |

`ALREADY_PAID` is not an error on its own: it says the month is history. What matters
is the issue list, which is graded:

- `BLOCKER` — activation is refused while it stands. Blocking codes:
  `EFFECTIVE_PERIOD_PRECEDES_CURRENT_MONTH`, `LEGACY_PAYOUT_INSIDE_COVERED_MONTH`,
  `LEGACY_EARNING_WITHOUT_SOURCE`, `LEGACY_WITHOUT_SALE`,
  `LEGACY_CLAWBACK_OUTSTANDING`, `PAYROLL_APPROVED_AT_OR_AFTER_ROLLBACK_MONTH`.
- `WARNING` — activation proceeds, and the warning is frozen into the attested
  inventory, so the activating owner has acknowledged it:
  `LEGACY_EARNING_SUPERSEDED`, `INVENTORY_CHANGED_SINCE_REVIEW`.

Record the returned `inventoryHash`. It is `sha256` over the whole classification, so
it is **window-specific**: changing `months` or `effectivePeriodKey` produces a
different hash, and a hash from another window is refused.

## Step 3 — Resolve blockers, then re-review

Fix the cause, not the report: pay or void the outstanding legacy payout, repair the
row that cannot be traced to a sale, settle the refund clawback. **Never** edit
`employee_commissions` by hand to make an issue disappear — the guard exists to stop
exactly that, and a rewritten row is no longer evidence.

Then re-run Step 2. The hash will almost certainly change; re-read the new inventory
and attest the **new** hash. Never reuse the old one. Activation recomputes the
inventory inside the transaction and refuses a mismatch with
`PAYROLL_CUTOVER_INVENTORY_STALE` plus the fresh hash, so a window that moved between
review and write cannot be covered silently.

### Choosing `effectivePeriodKey`

The first month plan payroll is the payroll of record. It must be the current salon
month or a future one: an earlier month is a retroactive claim on a month people were
already paid for, and is refused with `EFFECTIVE_PERIOD_PRECEDES_CURRENT_MONTH`.
Choose the current month when the salon switches now, or a later month when the
legacy ledger must finish an in-flight month.

## Step 4 — Activate

`POST /api/payroll-cutover/activate` (owner only, write-enabled tenant)

```json
{
  "expectedRevision": 0,
  "effectivePeriodKey": "2026-11",
  "inventoryMonths": 12,
  "inventoryHash": "<64 hex characters from Step 2>",
  "reason": "Owner reviewed the twelve-month legacy inventory; plan payroll from November 2026"
}
```

The transaction takes the tenant commission-configuration lock, re-verifies the actor
against the database, re-verifies the event chain, recomputes the inventory, compares
the hash, refuses blockers, writes **one** `payroll_cutovers` row and **one**
`ACTIVATE` event, and returns the new state.

Failure codes and the correct response:

| Code                              | Meaning                                                          | Response                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `PAYROLL_CUTOVER_STALE`           | `expectedRevision` is not the stored revision.                   | Reload `GET /api/payroll-cutover`, re-issue with the new revision.                                                    |
| `PAYROLL_CUTOVER_INVENTORY_STALE` | the inventory moved since review; response carries the new hash. | Re-read the inventory and attest the returned hash.                                                                   |
| `PAYROLL_CUTOVER_BLOCKED`         | a `BLOCKER` issue is still open; response carries the blockers.  | Return to Step 3. Do not activate with blockers outstanding.                                                          |
| `PAYROLL_CUTOVER_ACTIVE`          | plan payroll is already the payroll of record.                   | No action; this salon is already switched.                                                                            |
| `PAYROLL_CUTOVER_HISTORY_INVALID` | an event is missing, out of order, or its hash does not chain.   | Stop. Treat as an incident: the append-only history was tampered with out of band. Escalate before any further write. |

## Step 5 — Verify the switch

1. `GET /api/payroll-cutover` → `status: "ACTIVE"`, `revision: 1`,
   `effectivePeriodKey` as chosen, `inventoryHash` equal to the attested hash, one
   `ACTIVATE` history entry with `previousHash: null`, and the owner's reason.
2. Complete one test sale in the effective month. Expected: no new
   `employee_commissions` row is written (the writer guard skips legacy accrual from
   `effectivePeriodKey`), while the sale's plan-relevant evidence — line snapshots,
   performances, collection evidence — is written as usual. A sale dated **before**
   the effective month still accrues legacy, because the guard compares the sale's own
   salon month.
3. Calculate the effective month and read `GET /api/payroll-close/progress` (or the
   close screen). Expected: the staff appear with plan components, and the month is
   labelled an estimate until it is approved.
4. Confirm the legacy ledger row count for the effective month did not grow.
5. Before the first switched month is closed for real, measure NFR-03 on the host
   that will actually run payroll, with the same synthetic shape the performance
   suite uses (`RUN_CP007_PERFORMANCE=true`, 50 staff and 1,000 real receipts):
   month close under 10 s and every month-to-date sample under 500 ms. A host that
   is power-throttled, or that is running other suites, is not a valid measurement
   environment; record the numbers you got and the host state alongside them.

## Closing the first switched month

The month is closed exactly like any other month (calculate → approve → pay → confirm
payout). Two cutover-specific points:

- The close is the record of truth. Do not reconcile the plan close against legacy
  rows for covered months; those legacy rows are the superseded history the inventory
  already classified.
- Keep the attested `inventoryHash` and the activation event: they are what proves
  which evidence the owner reviewed on the day of the switch.

## Rollback

`POST /api/payroll-cutover/rollback` (owner only, write-enabled tenant)

```json
{
  "expectedRevision": 1,
  "reason": "Plan rates wrong for two staff; legacy ledger resumes while the plan is corrected"
}
```

Preconditions enforced by the service:

- the cutover is `ACTIVE` (otherwise `PAYROLL_CUTOVER_NOT_ACTIVE`);
- `expectedRevision` matches (otherwise `PAYROLL_CUTOVER_STALE`);
- the event chain still verifies (otherwise `PAYROLL_CUTOVER_HISTORY_INVALID`);
- **no payroll close is `APPROVED` for a month at or after the current salon month
  without a confirmed payout** (otherwise `PAYROLL_CUTOVER_ROLLBACK_BLOCKED`, with the
  offending `periodKeys`). Rationale: rolling back would let legacy start paying those
  same sales again on top of an approved plan month nobody has settled yet. Confirm the
  payout for that month first, then roll back; a month that is already paid out does
  not block the rollback, because its frozen snapshot can never pay those sales again.

Effects of a rollback: the stored status becomes `ROLLED_BACK` with a `ROLLBACK` event
appended, and the writer guard stops matching, so legacy accrual resumes for new sales
from the moment of rollback. Nothing is deleted, nothing is reversed, and every month
already calculated or approved under the plan stays exactly as stored. Rollback is not
a correction mechanism for a wrong plan month — use the existing correction path
(reverse and repost in the next open month) for that.

Reactivating later is a **new** activation: fresh inventory, fresh hash, new revision.
The preconditions above apply again.

## Evidence, audit and integrity

- `payroll_cutover_events` is append-only (database triggers). Each event stores
  `previousHash`/`stateHash`, and every read re-verifies the chain, so a rewritten row
  is reported as `PAYROLL_CUTOVER_HISTORY_INVALID` instead of being displayed as
  truth. Never issue `UPDATE`/`DELETE` against these tables.
- Activation and rollback take the tenant commission-configuration lock, the same lock
  sale completion takes before writing legacy earnings. The last legacy row and the
  switch therefore cannot cross.

## Prohibitions

- No manual `employee_commissions` edits, no backfill, no "recalculate history".
- No activating with an open `BLOCKER`; no activating a past month.
- No reusing an `inventoryHash` from another window or an earlier review.
- No production deployment, activation or rollback without separate explicit
  authorization.

## Appendix — local dry-run procedure

Acceptance evidence for this runbook is produced on a disposable cluster, never on
salon data:

1. Start the disposable cluster on loopback and confirm the test databases
   (`payroll_close_test`, `/tmp/cp005-…` data directory, server `TimeZone` UTC).
2. `RUN_CP005_ACCEPTANCE=true` runs
   `apps/api/src/routes/payroll-cutover.acceptance.test.ts`: activation, the writer
   guard, one legacy row after rollback, three verified history events, and the
   rollback guard on an approved month both before and after its payout is recorded.
3. `RUN_CP007_PERFORMANCE=true` runs
   `apps/api/src/routes/payroll-release.performance.test.ts`: the NFR-03 budgets on 50
   staff and 1,000 real receipts.
4. Tear the cluster down afterwards; no production database is touched at any point.
