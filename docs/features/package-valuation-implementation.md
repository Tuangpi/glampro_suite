# VALUE-01 — implementation plan

Status: **DONE — approved local implementation**, October 24, 2026. Policy version 1 is
approved in `package-valuation-policy-draft.md`; original task completion checks met.
This is one tracked deliverable, not authorization to start other tasks or deploy.

## Completion boundary and remaining rollout limitations

The original completion check is met: policy approval and exact-cent allocation,
isolated purchase/redemption/reversal/transfer/expiry/legacy reconciliation including
failure rollback and conflicting actions, and report UI separation of valued,
unvalued, expired and unpaid figures. Guarded activation is implemented/tested.
Historical partial notes below retain evidence, not new open-ended implementation gates.

Final local checks: combined acceptance 10/10, report/activation UI/hooks 24/24,
shared 187/187, workspace build/lint, API typecheck and repository format/diff pass.
Full web/repeat: 732 pass / 1 platform-login routing failure (App.test.tsx:33).
Prior full API/repeat: 590 pass / 1 messaging suppression failure / 24 skips, not
rerun this increment. These failures are recorded, not hidden or fixed in this task.

Extended opt-in benchmark seeds 10k unpaid sales and 500 expiry-backlog holdings;
ten reads reconcile SGD 1m active / SGD 50k expired / SGD 750k receivables and
51,500 movements. First report including expiry took 7370 ms; subsequent reads
2824/1149/1109/1265/1084/1151/1177/1260/1459 ms. Post-GC heap readings levelled
at 79 MiB (47/52/58/63/68/74/79/79/79/79). Concurrent local checks affected timing;
this is not isolated profiling, production SLO acceptance or a leak-freedom proof.

Manual browser smoke, target hardware/production load and authorized migration and
rollout remain outstanding. No installed browser automation dependency was added.
Later receivable collection has no existing application service; adding a collection
feature is not required for this approved valuation deliverable. No application
database migration, live salon activation or deployment occurred. VALUE-01 is locally
complete, not production-certified. Earlier IN PROGRESS notes below are historical.

## Partial implementation checkpoint

`apps/api/src/lib/package-valuation.ts` now implements the pure exact-cent core:
purchase consideration without double-discounting, independent net/tax allocation,
compact ordinal ranges, lowest-available draws and exact restoration. Its nine tests
include the approved worked examples and 1,275 conservation scenarios. The helpers
are not wired into sale transactions or reports yet.

Migration `20261024210000_package_purchase_valuation` adds immutable, tenant-scoped
activation and purchase-snapshot storage. Activation requires explicit currency,
version, actor and reason; the migration creates no activation rows and does not
backfill legacy holdings. Snapshots preserve source ids through ordinary deletion,
exact bigint amounts and original expiry. Database triggers enforce activation
provenance and append-only evidence; unique keys prevent duplicate purchase sources.
Source-row validation belongs in the future transactional write service.

Latest isolated API regression: 596 passed, 19 unrelated opt-in skips, zero failures;
all 50 migrations replayed on disposable PostgreSQL. Storage/allocation/tenant checks
19/19. New tables have no reported Prisma schema drift; older unrelated tables have
existing FK/index differences. No application database migration or activation ran.

Inspection confirmed Sale has no currency snapshot. Web formatting uses SGD, but
this is not evidence for historical purchases; subscription currency is not a sale
currency source. Use the explicit activation currency for future purchase snapshots;
an internal activation service now requires authenticated enabled management,
explicit policy 1/SGD confirmation and reason, and writable tenant/subscription
status. It shares the POS lock and records database-clock activation plus audit
atomically. Identical retries preserve original evidence; conflicting input rejects.
No route or UI exposes activation until atomic sale/ledger integration works.
This avoids offering an activation boundary while grants are not yet recorded.
Latest verification: shared 185/185, focused 20/20, isolated API 597 passed with
19 unrelated opt-in skips. No live salon activation or backfill was performed.
Do not infer historical currency or silently backfill unknown grants.

## Verified integration points

- `apps/api/src/services/sale.service.ts`: `grantHoldings` creates a holding when
  the purchase completes. Package redemption decrements its remaining quantity and
  writes a `CustomerRedemption`. Reversal restores quantities and marks redemptions
  reverted; an allowed purchase void deletes its granted holdings.
- `apps/api/src/services/session-transfer.service.ts`: transfer changes ownership
  under the existing tenant-wide prepaid lock and records immutable transfer history.
- `apps/api/src/lib/prepaid-lock.ts`: existing shared transaction lock and actor
  context should be reused, not replaced with a competing lock order.
- `apps/api/src/services/report.service.ts`: current liability snapshot reads
  operational session counts separately from prepaid/gift-card monetary totals.
- `packages/shared/src/schemas/report.ts` and `apps/web/src/pages/Reports.tsx`:
  extend the existing report contract and presentation without changing sales totals.

## Implementation sequence

1. **Purchase evidence and activation.** Add a versioned immutable valuation grant
   with original sale/line/holding/customer identifiers, original expiry, quantity,
   currency and net/tax/gross minor units. Verify the application's sale currency
   source before snapshotting it; a subscription's currency is not sale evidence.
   Do not guess currency from locale or retrofit uncertain legacy values. Establish
   an explicit activation boundary. Held carts do not grant value; zero-priced
   completed purchases have known zero value.
2. **Exact allocation and movements.** Implement pure integer allocation with
   stable ordinals or compact ranges. Persist immutable grant, redemption,
   exact-restoration, paired transfer and allowed purchase-void evidence in the same
   transaction as the source action. Preserve history through holding deletion.
   Reuse tenant isolation, actor attribution, append-only database protection and
   the existing prepaid lock order. Prevent duplicate movement source actions.
3. **Expiry and coherent reporting.** Record deterministic, idempotent transitions
   effective at original expiry, even when recorded later. Restorations after expiry
   enter the expired bucket. Read counts and reconciliation from one consistent
   database snapshot and as-of instant. Expose company-wide active/expired totals
   by currency, net/tax/gross, movement reconciliation, valued/unvalued counts and
   incomplete-valuation warnings. Show holdings linked to unpaid purchases without
   inventing a mixed-sale cash allocation. Keep receivables and existing prepaid/
   gift-card totals separate. No pre-activation historical closing endpoint.
4. **Report UI.** Present remaining package purchase value alongside operational
   counts, separate expired values, original-tax/gross components and clear unknown
   and unpaid-purchase disclosures. Clearly retain company-wide scope when an
   outlet is selected. Do not call released or expired value recognised revenue.
5. **Disposable verification and handoff.** Replay all migrations only on a fresh
   isolated database. Add allocation unit tests, database/HTTP reconciliation tests
   and report component tests. Run relevant existing suites and workspace checks;
   inspect the final diff and update TASKS/PROGRESS with actual results. Application
   database migration, deployment, commit and push require separate authorization.

## Transactional ledger checkpoint

Migration `20261024220000_package_valuation_movements` adds an explicitly mutable
ordinal/ownership projection and append-only signed bucket movements linked to
immutable purchase evidence by tenant-bound foreign keys. Source keys are unique
per purchase. Grants, redemptions, exact restorations, paired transfers, paired
expiry and purchase voids record net/tax/gross and ordinals. System expiry has no
staff attribution and uses original expiry as its effective time.

`apps/api/src/services/package-valuation-ledger.ts` is called from completed package
grant, redemption and void paths in sale.service.ts and from session transfer.
The existing prepaid lock serializes these writes with activation. Missing legacy
snapshots remain unvalued. Purchase values use stored discounted line consideration
and stored tax; purchase void preserves evidence through holding deletion.

The expiry helper is transactional and idempotent and is now connected to the current
report snapshot. Activation remains internal-only. Report UI, lifecycle race coverage,
post-expiry restoration and expanded tax/discount acceptance remain outstanding.

## Current report API checkpoint

`GET /api/reports/package-valuation` uses existing authentication and reports module
entitlement. It explicitly removes outlet scope while preserving tenant and actor.
The prepaid lock serializes expiry and valuation lifecycle writes; database time is
sampled after lock acquisition. There is no historical/client-selected as-of.

The report reconciles each purchase's signed movement amounts, quantities and ordinal
interval boundaries per current owner/bucket with the projection and source holding.
Mismatch refuses the report and rolls back report-triggered expiry. Active/expired
net, stored original tax and gross stay separate from unvalued legacy counts and
prepaid/gift totals. Unpaid disclosure counts remaining holdings linked to source-sale
receivables and sums each source sale once, not an allocated package cash balance.

Isolated API regression: 598 passed, zero failures, 20 opt-in skips; shared 187/187.
Build/typecheck/lint passed. Acceptance includes concurrent/repeated reports, known
zero ordinal corruption, outlet-independent totals and report-triggered expiry.
All tenant purchase/movement evidence is currently read under the lock; large-tenant
performance remains unverified. No activation route/UI or application migration.

## Report UI checkpoint

Reports now contains an independent company-wide package purchase-value panel with
its own snapshot timestamp and refresh action. The hook validates the shared report
contract and shares the reports invalidation prefix, without sales-range parameters.
Active/expired net, original tax and gross remain separate from unknown holdings,
whole-source-sale receivable disclosures and existing prepaid/gift monetary totals.
Unpaid value is not reduced and expiry is not labelled recognised revenue.

Inactive/loading/error states never imply successful zero valuation; refresh errors
hide cached valuation rather than presenting it as current. Whole-unit bigint display
preserves exact cents for large aggregates. Activation remains internal-only.
Full web regression 724/724; focused report/hook 15/15, typecheck/lint/build passed.
No manual browser walkthrough or database access this increment. Broader lifecycle
acceptance and large-tenant performance remain unverified; VALUE-01 is not complete.

## Outstanding reconciliation checks

### Rollback and competing void acceptance — October 24, 2026

The existing disposable lifecycle suite now injects tenant-scoped movement failures
at RESTORE, TRANSFER_IN and PURCHASE_VOID. Deep comparisons verify rollback of
holding, projection, snapshot/movements, sale rows, redemption markers, transfer
history, outstanding debt, points, staff performance/commissions and tenant audit.
In particular, failed TRANSFER_IN must roll back the already-written TRANSFER_OUT,
ownership change and transfer history. Subsequent retries reconcile successfully.

Duplicate concurrent redemption voids restore once and preserve the original void
reason/actor against later retries. Purchase void competing with redemption or
transfer, alongside a report, has one state-changing winner and coherent final
value. These are scheduling-based concurrency checks, not exhaustive scheduling
proof or a production throughput guarantee. No application source behavior changed.

Combined HTTP/ledger/lifecycle acceptance: 10/10 passed; API typecheck/lint/build
passed. Repository format/diff passed. Full API run and repeat: 590 passed, 1 failed,
24 opt-in skips; messaging.service.test.ts:295 rebooking suppression expects
ALREADY_REBOOKED but receives null, also reproduced with that suite alone. Root
cause remains unverified and unrelated messaging code was not changed. This is not
a clean full regression. Disposable failure trigger/function cleanup verified. Reporting expiry/debt
load, sustained memory/lock contention and manual browser walkthrough remain next;
production performance and later receivable collection remain unverified. The
earlier checkpoint notes below describe historical coverage, not current gaps.

### Remaining lifecycle and synthetic performance — October 24, 2026

Disposable lifecycle acceptance now includes whole-set valuation (one ordinal per
whole set), transfer-back after recipient redemption, restoration to current owner,
original-sale customer preservation, purchase-void refusal after transfer back,
competing transfer/redemption/report, mixed-sale voucher exclusion, post-expiry
exact restoration, repeated void idempotence and allowed expired-purchase void.
Combined HTTP/ledger/lifecycle acceptance passes 6/6. The older ledger test's
forced-failure trigger is now tenant-filtered to avoid parallel fixture interference.

POS voucher rules cover SERVICE/PRODUCT only, not PACKAGE. The mixed-sale test
confirms only the service receives its voucher share and whole-source debt is counted
once. Pure valuation tests already cover nonzero stored voucher attribution without
changing voucher eligibility. No later-receivable-collection application service was
found; end-to-end collection is unavailable, not verified via invented database edits.

`apps/api/src/services/package-valuation-report.performance.test.ts` is opt-in via
`PACKAGE_VALUATION_PERFORMANCE_TEST=1` and refuses all but disposable localhost
port 55462 / valuation_test. It seeds storage-level valid grants and two draw/restore
pairs, then checks complete reconciliation for 1k/10k live holdings and 5k/50k
movements, with three timed report samples per size. October 24 local PostgreSQL 18
results: 112/108/83 ms at 1k, 580/550/561 ms at 10k; process heap before/after the
larger sample was 229/684 MiB (not peak or retained heap). A competing prepaid-lock
operation acquired its lock at 601 ms; this observation is scheduling-dependent.

These are synthetic diagnostics, not a production latency/memory SLO or throughput
guarantee. Fixtures bypass POS setup/source-sale rows and contain no expiry backlog
or unpaid balances. Target hardware, sustained memory, debt/expiry-heavy reports
and real concurrent POS load remain unverified. All evidence is still loaded while
holding the prepaid lock. No optimization or weakened reconciliation was introduced.

Full API regression: 591 passed, zero failures, 24 opt-in skips; new acceptance and
benchmark run separately. API build/typecheck/lint and repository format/diff passed;
web/shared sources unchanged and their suites not rerun. Further reversal/transfer
failure rollback, broader void races and browser walkthrough remain; VALUE-01 stays
IN PROGRESS. No application DB access, migration, salon activation or deployment.

### Lifecycle and activation checkpoint — October 24, 2026

Expanded disposable acceptance now verifies held-cart exclusion, idempotent
completion, discounted multi-unit purchases with stored GST, part-paid disclosure,
immutable value after catalogue/session-count/GST-setting edits, concurrent draws
and report reads, and exact reverse-order restoration. Prior ledger checks remain.

`POST /api/reports/package-valuation/activation` is now exposed through authentication,
reports entitlement, management role and writable-tenant guards. The existing locked
service rechecks actor, tenant/subscription and owner 2FA; explicit policy 1 / SGD /
confirmation / reason is the only accepted input. Actor, tenant and time are not
client-selected. Matching retries return original evidence; conflicts cannot replace it.

The inactive report panel offers the one-time control only to writable management
sessions, explains immutable activation and unknown legacy holdings, requires explicit
confirmation and reason, and disables pending submissions. Failed/uncertain requests
refresh evidence without automatic retries. Successful activation refreshes reports;
the active panel displays the original actor/reason and boundary.

Verification: disposable ledger + HTTP acceptance 2/2; full API 591 pass / 0 fail /
22 opt-in skips (new acceptance run separately), full web 733/733, shared 187/187,
focused web 24/24; workspace typecheck/lint/build passed. Existing migrated disposable
PostgreSQL was reused; no new migration replay or application DB access is claimed.

Still unverified: whole-set purchase integration, voucher-attributed discounts,
later receivable collection, transfer-back, post-expiry restoration, broader
conflicting-action races, manual browser walkthrough and large-tenant reporting
performance. All tenant evidence is still loaded under the prepaid lock. This is
not load-test or rollout evidence; VALUE-01 remains IN PROGRESS.

The original checklist below remains the full acceptance matrix, not a claim that
every listed scenario is still unimplemented or has now been verified.

- Discounted and fully discounted purchases; stored tax; multiple package units;
  whole service sets; indivisible cents and out-of-order exact restorations.
- Completed unpaid/part-paid purchases and later receivable collection; held carts
  remain excluded; later catalogue and tax-rate edits cannot rewrite snapshots.
- Transfer, transfer back, redemption before/after transfer, restoration to current
  owner, forbidden purchase void after transfer and allowed untransferred void.
- Expiry boundary, repeated expiry processing, post-expiry restoration and permitted
  purchase void of an expired grant. Active and expired buckets reconcile separately.
- Missing/ambiguous legacy evidence stays unknown, including expired holdings;
  known zero is distinguishable from unknown. Currencies never mix in one total.
- Duplicate/retried source actions, concurrent redemption/transfer/void/report reads,
  rollback on valuation-write failure, tenant isolation and immutable history.
- Original sale/treatment customer, GST, refund exclusions and existing monetary
  reports remain unchanged. Surviving valuation evidence reconciles deleted holdings.

Do not mark VALUE-01 DONE until implementation and these applicable checks are
supported by recorded evidence. Policy approval is not evidence of working code.
