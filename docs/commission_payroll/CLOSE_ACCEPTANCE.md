# CP-005 monthly close acceptance checkpoint

## October 31 continuation — prospective ordinary credit instalments

Checkout freezes explicit funding/debt evidence; later receipts append separate
zero-unit ORDINARY_COLLECTION sources. Complete independent payment, debt,
collection, allocation and rate evidence reconciles before loading. No legacy
backfill or synthetic cash is persisted. Same-key concurrent retries create one
payment/source. Stale drafts reject after collection. Real calculation/approval
freezes original history; the next month's final payment contributes only 27.53
after the first 27.52, retaining original line GST rounding.

Unused expired-credit purchase voids now replay expiry and exact terminal removal
from the preserved holding with explicit NO_MOVEMENT. Their real-writer monthly
calculation and persisted approval pass. Expiry alone is not a new spend.

Monetary correction persistence additionally verifies concurrent same-revision
corrections commit once with no original approved-state rewrite. Source corrections,
approval/source races, plan-switch integration, mounted API/UI, browser and performance
acceptance remain unaccepted. M1 remains IN PROGRESS; M2–M5 are not complete.

Final guarded payroll regression: **482 passed, 0 failed, 6 gated skips**;
shared **302 passed**. API build, targeted ESLint/Prettier and whitespace checks
passed. Evidence is in `/tmp/cp005-all-final-regression.log` and companion
`/tmp/cp005-all-{shared,build,lint,prettier}.log` files. No close browser or
performance results are claimed; no production/application database was used.

## October 31 continuation — partial lines and expired restored credit

Partial session/credit coverage now passes real checkout, monthly calculation,
stale-draft rejection, recalculation and persisted approval, with and without cash.
Prospective version-2 evidence binds exact coverage, package/credit tenders and
explicit external allocations; cash cannot consume session-covered gross cents.
Existing disjoint version-1 evidence is unchanged. Tests include external cash on
the partially covered line and preserve independent line-level GST rounding.

A wholly credit-funded ordinary line alongside an externally funded line no longer
receives a false missing-allocation marker. Its independent monthly regression
verifies zero ordinary base without treating credit as new cash.

Fully restored used-credit purchase voids after expiry now reconcile through the
surviving complete ledger and pre-deletion snapshot, then calculate and approve.
Historical expiry at spend/restore, exact REMOVAL and NO_MOVEMENT confirmation still
verify. Unused expired-credit voids remain a separate boundary. Focused funding and
monthly cases: 9/9; restored-credit database cases: 5/5; no skips in either run.

These results supersede partial-line and expired-restored-credit refusal claims
below, not the overall status. **M1 remains IN PROGRESS; M2–M5 remain TODO.**

## October 31 checkpoint — disjoint session/credit usage

Settled session-package/credit receipts now pass real-writer monthly calculation and
persisted approval when session coverage and credit/cash lines are disjoint. Complete
holding histories, package tender coverage and prospective frozen funding evidence
must reconcile independently. Credit/session tenders add no cash; only external
allocations contribute cash and the ordinary service base. Both credit-only residual
and allocated-cash variants pass stale-draft rejection, recalculation and immutable
approved-state acceptance. SQL immutability and loader-level missing-evidence refusal
are checked separately. Partial-line mixed usage refuses
`MIXED_SESSION_CREDIT_PARTIAL_LINE_NOT_SUPPORTED`; instalments still refuse
`VALUE_SALE_INSTALMENT_NOT_SUPPORTED`. Mixed corrections/voids and browser acceptance
remain open. M1 is IN PROGRESS, not DONE. Supersedes earlier blanket mixed-usage gates.

## Status — October 30, 2026

**IN PROGRESS, not accepted.** CP-004 remains latest completed. No CP-003A or
CP-006 work started. All results below describe actual local checks, not release
or production readiness.

The five remaining delivery gates are tracked as CP-005-M1–M5 in
[TASKS.md](TASKS.md). **M1 authoritative lifecycle loading is still open**, despite
passing monthly private-credit and private-transfer subsets. Sharing, restorations,
refunds/voids and the other required unsupported paths must be integrated and
verified, not merely rejected, before M1 is complete. Next-open corrections,
carry/plan-switch acceptance, mounted application workflows and final acceptance
remain separate milestones. The checkpoint results below do not complete them.

During implementation, run focused checks for fast feedback and consolidate
integrated regression at the milestone gate. Preserve all existing acceptance
requirements; faster cadence does not permit weaker assertions or omitted paths.

## Latest checkpoint — prepaid refund HTTP settlement workflow

- `POST /sales/package-holdings/:id/refund` and
  `POST /sales/value-package-holdings/:id/refund` already carried auth,
  sales/packages module, writable-tenant and manager/owner guards and already
  forwarded the optional `settlement` confirmation into the shared journal writer.
  That workflow now has HTTP-level acceptance instead of service-only coverage.
- New `apps/api/src/routes/prepaid-refund-settlement.http.test.ts` drives the real
  router, middleware, zod validation and refund service over HTTP with replaced
  persistence seams. One confirmed cancellation writes exactly one
  `prepaidRefundSettlement` row (salon tenant, source key, holding/sale/line, actor
  and role, reference, currency, zero net/tax/gross, 54500 cancelled gross, frozen
  request plus operational hash) next to one refund source event, inside the
  authenticated salon-wide scope.
- Retry with the identical body replays the stored event and writes no second
  settlement, journal row or holding update. A changed reference refuses 409, and a
  row whose reference or frozen money evidence was altered refuses 409
  `...unavailable`. An outlet-scoped session refuses 403 salon-wide, STAFF/CASHIER
  refuse 403 before any transaction, a disabled session 401s and a foreign outlet
  404s before persistence, and a malformed confirmation is refused 422 by the
  strict schema.
- A refused close names its cause, so an operator can tell a supported path from an
  unsupported one: `MIXED_SESSION_CREDIT_PARTIAL_LINE_NOT_SUPPORTED` (one line partly
  covered by sessions alongside stored credit) and `VALUE_SALE_INSTALMENT_NOT_SUPPORTED` (a
  part-paid credit spend). All read
  `409 Authoritative payroll inputs unavailable: <CODE>.` and write no close.
- A restored spend whose holding a later purchase void deleted is read, not refused:
  `loadPayrollValueSpendHistory` rebuilds the deleted row from the void's hash-verified
  pre-deletion snapshot, admits the `VOID` purchase it belonged to, accepts only the void
  writer's own one-per-capture collection reversal, verifies the terminal `REMOVAL`
  balance row that emptied the credit, and replays the spend/restore on the ledger that
  outlived the row (the removal is excluded from the replay and still frozen in evidence).
  Any snapshot that fails those checks keeps the generic
  `VALUE_SPEND_HISTORY_UNCONFIRMED`.
- Void gates are scoped by the writer, not by guesswork: a purchase whose credit is
  still spent cannot be voided (`HOLDING_ALREADY_SPENT`), so the loader's used and
  transferred gates defend against edited rows; undoing the spend and then voiding the
  purchase _is_ allowed and is now loadable, pinned by
  `payroll-void-restored-spend.acceptance.test.ts`. With writer-supported `NO_MOVEMENT`
  confirmations, full monthly loading, calculation and persisted approval pass: retained
  cash 500.0000, spend/restore bases 75.0000/-75.0000, stable input hash and unchanged
  approved calculation evidence. Missing SPEND, RESTORE or REMOVAL evidence refuses.
  The month still refuses `SALE_VOID_CASH_UNCONFIRMED` without confirmation. Real-writer
  probes pin expired restored credit at `PURCHASE_VOID_HISTORY_UNCONFIRMED` and prove
  unconfirmed returned-cash snapshots alone do not authorize close. Five acceptance
  cases pass; payroll regression 421 passed, 0 failed, 6 skipped (427 total).
- Every purchase void now writes the pre-deletion holding snapshot, not just the
  no-movement ones: a returned-cash void deletes the same credit rows, so restricting
  capture to `NO_MOVEMENT` left those credits with no evidence at all. Only the
  no-movement path additionally writes the cash confirmation that binds the hash. The
  capture proves salon scope and ties itself to the voider through the sale's own
  `voidedById`, because the void writer takes the actor as a parameter and a stricter
  session-actor check refused voids the writer accepts.
- A refund without confirmation still persists as a legacy capture with no journal
  row, and confirmation cannot be added afterwards (409), so the close loader keeps
  refusing that capture as `PREPAID_SETTLEMENT_MISSING` instead of accepting a
  retroactive claim.
- Refund suite **116/116 passed** over `payroll-value-package.http.test.ts`,
  `payroll-close.http.test.ts`, the new HTTP suite, `prepaid-refund-settlement.test.ts`
  and `payroll-value-package-refund.test.ts`, with zero skips; API typecheck, ESLint
  and Prettier clean. Logs `/tmp/cp005v-http-settlement.log`,
  `/tmp/cp005v-refund-suite.log`, `/tmp/cp005v-tsc2.log`, `/tmp/cp005v-eslint2.log`,
  `/tmp/cp005v-prettier3.log`.
- Deliberately not changed: confirmation stays optional, so a paid refund can still
  be captured without settlement evidence and then fail closed at close. Making it
  mandatory for every prepaid payout is an owner business decision, not a silent
  code change. Remaining M1 work: mixed session/credit usage, spend-sale instalments,
  full-credit paid lines without allocation evidence and the remaining void gates.

## Previous checkpoint — prepaid refund settlement inventory

- Prepaid package and value-package refunds are now inventoried from their own
  append-only settlement row, never from a capture event alone. Each settlement is
  validated against the pre-cancellation holding replay, the original sale-line
  allocations/outstanding debt and the frozen refund request, re-deriving payout,
  admin fee, net, tax and payout method instead of trusting them. Unbound, tampered
  or ambiguous evidence refuses as `PREPAID_REFUND_SETTLEMENT_UNCONFIRMED`.
- The monthly loader reads settlements before tenant and inventory work, so a
  settlement lands in exactly one payroll month — the salon-local month of its
  cancellation capture. Two settlements for one holding or one operation key refuse
  (`PREPAID_SETTLEMENT_DUPLICATE`); a stored row that disagrees with the replayed
  holding, a historical original capture moved between months, or a refund capture
  outside its settlement month refuse (`PREPAID_SETTLEMENT_INVENTORY_UNCONFIRMED`,
  `PREPAID_ORIGINAL_MONTH_CAPTURE_UNCONFIRMED`,
  `PREPAID_REFUND_MONTH_CAPTURE_UNCONFIRMED`); a month capture with no settlement
  refuses as `PREPAID_SETTLEMENT_MISSING` instead of being dropped.
- A settled refund is an external cash outflow from salon cash: it adds no sale or
  commission source, uses only the settlement's net cents, and freezes the buyer's
  original deposit, allocations and award lineage in `refundPayouts` so a later month
  cannot re-claim the same money or units.
- New opt-in DB acceptance `prepaid-refund-month.acceptance.test.ts` buys, refunds and
  loads one salon-local month: a single settlement/history, one 50000-cent payout and
  zero salon cash; a second cancellation then rejects the stale approval with
  `/inputs changed/`, recalculation shows two 50000-cent payouts netting 500.0000 of
  remaining sale cash, approval succeeds, and a synthetic legacy capture without its
  settlement refuses `PREPAID_SETTLEMENT_MISSING`. The loader unit matrix adds
  duplicate holding, duplicate operation key, orphan holding and missing settlement.
- Selected close API **332/332 passed, zero failures/skips**, five isolated DB suites
  included; the three directly touched suites **44/44**; API typecheck, ESLint and
  Prettier clean. Logs `/tmp/acc-all.log`, `/tmp/acc-two.log`, `/tmp/tsc.log`,
  `/tmp/lint.log`, `/tmp/prettier3.log`. No web checks, schema/migration change,
  earnings activation or deployment.
- Blockers unchanged: refund captures written before settlements now fail closed
  instead of loading, and prepaid refund HTTP workflows, close API/UI mounting,
  source-base corrections, plan-switch/performance and browser acceptance stay open.

## Previous checkpoint — private credit ownership transfers

- Private transfer history now replays complete GRANT/SPEND/TRANSFER states from
  the original buyer to current owner and remaining balance, independently matching
  every transfer audit by tenant/holding/from/to/amount/actor/reason/expiry and timing.
  Each spend uses its verified historical owner; purchase ratio/sellers never change.
- Transfer adds no commission source or external cash, but complete evidence changes
  the input hash and invalidates a stale draft. Real monthly acceptance covers original
  buyer spend, recipient spend, two transferred holdings of one package and return
  transfer after approval while stored calculation and statement hashes stay frozen.
- Eight missing/mismatched transfer audit/ledger corruption checks refuse without
  draft/audit mutation. Unit checks cover round trips, ambiguous chains and audit
  ordering. Ledger timestamps are transaction-start times; audit append may follow
  but must precede the next state transition. No timestamp equality assumption.
- Selected close API 298/298, zero failures/skips, five isolated DB suites; shared
  302/302; API typecheck/lint/build/format/whitespace pass. Logs
  `/tmp/cp005-transfer-*`. No web checks. Disposable PostgreSQL stopped; fixtures
  retained. No application DB/schema changes or earnings activation.
- Sharing/membership/consent replay, restoration/refund/void and expiry edits remain
  unavailable. Next sharing reconciliation, then refunds/voids. Close UI/router
  remain unmounted; performance and mounted app/browser acceptance still required.

## Previous checkpoint — private-credit monthly integration

- Authoritative monthly loader accepts only settled private-credit service/product/
  FOC receipts proven by the complete sale/holding reconciler. Independent month
  sales, payments, redemptions, captures and collections match exactly, including
  multiplicity and tenant identity. Payment/source-only candidates cannot disappear.
- Verified credit tenders are excluded from external payment operations. VP_SPEND
  retains original purchase ratio; ordinary activity matches external-net allocations;
  FOC retains frozen full list price. Complete sale/holding evidence is frozen with
  inputs, under the established prepaid-before-tenant transaction boundary.
- Two holdings of the same catalogue package on one receipt are distinguished by
  independently matching sibling operational redemptions, not catalogue ID alone.
  Missing/orphan sources continue to refuse.
- Real checkout/monthly acceptance verifies mixed lines, same-package two-holding
  split spends, 591.7400 then 1183.4800 external net cash including original package
  purchases (never credit tender face value), stable reload and 15 independent month
  omission/duplicate/foreign-row refusals without draft/audit changes. New activity
  refuses stale approval; approved history survives later catalogue edits/spends;
  following empty month has zero activity/cash and retains approved prior evidence.
- Selected close API 294/294, zero failures/skips, five isolated DB suites; shared
  302/302; API typecheck/lint/build pass. Logs `/tmp/cp005-month-*`. No web checks.
  Disposable PostgreSQL stopped; fixtures retained. No application DB/schema changes.
- This is narrow internal monthly support, not complete CP-005 acceptance or earnings
  activation. Transfers/sharing, refund/voids, mixed session-package usage, spend-sale
  instalments and full-credit paid lines lacking ordinary allocation still refuse.
  Router/screen remain unmounted; performance and full app/browser acceptance remain.

## Previous checkpoint — monthly prepaid lock prerequisite

- Calculate/approve acquire prepaid before tenant at the outer close transaction
  boundary, before actor/source reads. Direct authoritative input loading follows
  the same order; existing tenant-only non-loading actions/reads remain unchanged.
- New regression tests verify exact outer-boundary and direct-loader order. Real
  PostgreSQL barriers observe each action waiting for prepaid while the holding
  writer acquires tenant NOWAIT; nested re-entry completes and probe rollback
  preserves revision/audit counts. Existing stale approval/frozen checks still pass.
- Selected close API 293/293, zero failures/skips, all four isolated DB suites run;
  API typecheck/lint/build pass. Logs `/tmp/cp005-lock-*`. No web checks or application
  DB/schema changes. Disposable PostgreSQL stopped, synthetic fixtures retained.
- Monthly prepaid integration is NOT accepted. Next wire independent month
  inventories and frozen value-sale evidence with no-fresh-cash and stale-approval
  checks. Lifecycle, performance and mounted application/browser acceptance remain.

## Previous checkpoint — private value-credit sale allocation

- Added internal non-activating `loadPayrollValueSaleAllocation`: takes prepaid
  then tenant locks, authenticates manager/owner, inventories all receipt lines,
  payments, redemptions, sources, collections and refund/outstanding activity.
  Independently matches every spend to complete holding history and source evidence.
- Exact external allocations replay cumulative GST and original cash sellers.
  Ordinary bases/splits/units and frozen checkout economics must match. FOC uses
  immutable original list price. Cash resolver sees only external payments, never
  credit tenders as new money. No inferred allocation or assumed zero ordinary base.
- Expanded real checkout acceptance verifies mixed service/product/FOC ordinary
  bases 64.2200/27.5200/492.0000, 91.7400 external net cash and 41.6667 credit-spend
  ratio; second receipt reconciles two holdings with 45.8700 external net. Reload,
  catalogue edit and role/outlet/tenant checks pass. Fourteen read-only corruptions
  cover receipt balance, redemption/source/collection inventories, orphan sources,
  ordinary bases/duplicate staff, GST, sellers, tenders, foreign tenant, refund,
  instalments and frozen economics. Restoration and unavailable full-credit paid
  lines still refuse. No legacy earnings or close/audit writes occur.
- Selected API 377 passed, zero failures, one opt-in CP-004 SQL lifecycle suite
  skipped; four CP-005 isolated DB suites ran. Shared 302/302; API types/lint/build,
  formatting/whitespace pass. Logs `/tmp/cp005-value-sale-*`; no web checks this slice.
- Monthly prepaid gate remains closed. Next integrate month inventory and frozen
  evidence/no-cash reconciliation; first fix outer close lock order to prepaid
  BEFORE tenant lock. Transfers/sharing/refund/void loading, plan-switch/performance,
  mounting and full HTTP/browser acceptance remain. CP-005 is IN PROGRESS, not DONE.

## Previous checkpoint — private value-credit holding history

- Internal `loadPayrollValueSpendHistory` reads complete tenant-scoped operational
  purchase/collection/payment/redemption/balance/source/rate inventories under the
  same prepaid-then-tenant lock order as writers. Private untransferred credit only;
  legacy OPENING, sharing, transfers, refunds and restorations fail closed.
- Spend verifier recomputes cumulative paid/credit ratio and performer split/units,
  matches operational identity/timestamps and frozen purchase, and independently
  replays STORED_CREDIT_SPEND rates. Independent balance chain must start at GRANT,
  consume every operational spend exactly once and reach current remaining credit.
- Real checkout acceptance covers purchase, three spends (83.3333 + 83.3334 +
  83.3333 = 250.0000), stable reloads, later catalogue edits, missing and corrupted
  ledgers/captures/collections/redemptions/tenders/rates, orphan usage, role/outlet/
  tenant refusal and void-restoration refusal. No close/audit records are created;
  default monthly prepaid loading still refuses. Holding readiness is not proof
  of sale-wide ordinary/prepaid allocation or no-double-base reconciliation.
- Selected API: 377 passed, zero failures, one opt-in CP-004 SQL lifecycle suite
  skipped; four CP-005 isolated database suites ran. Shared 302/302; API types,
  lint/build pass. Logs `/tmp/cp005-value-*`. No web checks in this continuation.
- Next: authoritative sale-level allocation and monthly no-cash reconciliation;
  transfer/sharing and refund/void history; plan-switch/performance and application
  mounting/full browser acceptance. CP-005 remains IN PROGRESS and non-activating.

## Previous checkpoint — owner carry authorization and repair

- Added owner-only controls in the unmounted close screen for explicit opening
  inventory, component mapping/write-off and exact fallback debt write-off. All
  authorizations require evidence reference, reason and explicit review confirmation;
  edits/conflicts reset confirmation and reload authoritative revisions. Opening
  inventory is never auto-filled with assumed zero balances. Settlement replacement
  semantics and no-cash/non-activation behavior are disclosed.
- Fixed the owner read contract so missing opening and stale settlements can be
  repaired: complete staff inventory (including departed), opening eligibility,
  independent authorization revisions, exact balance hashes and stale flags. Only
  repair reads bypass settlement resolution; default calculation and approval still
  refuse unresolved evidence. Audit inconsistency continues to throw.
- Selected API 306/306 (three isolated PostgreSQL suites, zero skips), then expanded
  carry suite 1/1 with real HTTP/auth/DB persistence. Covers manager/outlet refusal,
  missing-opening inventory, changed-balance repair, stale revision, injected actor,
  server-owned approval identity and retry conflict. Selected web 40/40, shared
  302/302; API/web typecheck/lint/build pass. Logs `/tmp/cp005-carry-*`.
- CP-005 remains IN PROGRESS. Prepaid-credit spending/refund/void loading,
  app mounting and full browser/reconciliation/plan-switch/performance acceptance
  remain outstanding. No application DB/schema changes or earnings activation.

## Previous checkpoint — restored sessions, partial FOC and close groundwork

- Original grant/ordinal/quantity/ownership replay now includes restoration and redraw.
  Verified VOID snapshots link the latest attribution, exact source reversal and a
  historical manager/owner request audit (reason, revision, identity and request hash).
  Legacy-unbound evidence refuses; no backfill. Writer stamps audit time explicitly
  because PostgreSQL transaction-start time can precede restoration.
- Isolated real writer verifies a void after three corrections, idempotent retry,
  restored quantity, exact latest 5/5 reversal, zero collection and stable monthly
  reload. Five read-only audit corruptions preserve draft/audit. Approved September,
  October and February calculations remain unchanged. Restored ordinal one is redrawn
  in April at original 10.0000 value alongside a distinct 492.0000 uncovered FOC unit.
- Partial package FOC now independently matches checkout covered quantity to verified
  cross-holding coverage, applying list price only to uncovered units. Full coverage
  cannot create an ordinary FOC source. Tests reject changed price/identity/coverage.
- Close router groundwork includes manager reads/calculation/adjustments, owner approval,
  payout and carry authorization, and own frozen-statement reads. The management screen
  handles explicit months, stale revision reload, adjustments, frozen status and separate
  payout. **Neither is mounted into the application.** Opening/settlement UI is absent.
- Fresh selected API **306/306**, zero skips, including all three isolated PostgreSQL
  suites and seven real HTTP/auth tests with mocked persistence; shared **302/302**;
  selected payroll web **40/40**. API/web typecheck, lint and build pass. Logs and exit
  markers `/tmp/cp005-complete-*`. These are focused regressions, not full-workspace,
  browser or performance acceptance. No new migration or application database access.
  Disposable PostgreSQL stopped cleanly after checks; synthetic fixtures retained.
- Remaining: authoritative prepaid-credit spending/refund/void loading; opening/
  settlement UI and application mounting; live HTTP/browser permissions and workflows,
  remaining transactional/reconciliation/plan-switch/performance checks. Existing
  unsupported refund/sale-void gates remain. CP-005 is **IN PROGRESS, not DONE**.

## Previous checkpoint — monthly correction reconciliation

- Complete operational correction inventory and full verified holding chains now
  reconcile monthly revision-key operations, exact preceding-source reversals and
  independent no-cash evidence. Non-correction reversals and missing evidence refuse.
- Real writer: two same-month corrections, idempotent retry and stable DB reload;
  original 10.0000 reverses exactly and replacement splits move 4/6 then 2.5/7.5.
  A third following-month correction reverses only 2.5/7.5 and replaces with 5/5.
  Both months have zero collections; sessions/original purchase economics unchanged.
- Missing reversal, request, prior snapshot, altered base, omitted monthly replacement
  and omitted operational inventory refuse through stored-close calculation. Saved
  draft/audit unchanged; approved September/October/February calculations unchanged.
  January carry is an explicit synthetic boundary because prior fixture sales there
  are intentionally invalid; February/March inputs use the authoritative loader.
- Selected API **277/277**, three isolated DB suites, zero skips; shared **302/302**;
  API build/typecheck/lint pass. Logs `/tmp/cp005-monthly-*`. Existing isolated DB only;
  no application DB/schema changes, deployment, activation or browser walkthrough.
- CP-005 remains IN PROGRESS. Next: session-void restoration, prepaid-credit lifecycle,
  partial package FOC and close API/UI/full acceptance. CP-003A/CP-006 untouched.

## Previous checkpoint — redemption correction-chain holding history

- Complete holding snapshots/replacement sources/exact preceding-source reversals
  now reconcile contiguous revisions, request hash, actor/reason, previous snapshot,
  original ordinals/coverage/value and historical rate selection. New writer retains
  request ordering; legacy corrections without request evidence refuse, no backfill.
- Actual correction writer and persisted reload verify two corrections and retry:
  original 10.0000 session base splits 4/6 then 2.5/7.5 without consuming/restoring
  sessions. Four read-only corruptions refuse; approved September/October unchanged.
  Unit tests include 17 invalid chains and independent loader inventory checks.
- Selected API **276/276**, three isolated DB suites, zero skips; shared **302/302**;
  API typecheck/build/lint pass. Logs `/tmp/cp005-correction-*`. No application DB
  access/schema changes or browser walkthrough. Existing isolated CP-005 DB only.
- This does NOT enable monthly corrections: the monthly gate still refuses and
  writes no close. Next: correction operational inventory/no-cash monthly integration,
  session void restoration, credit lifecycle, partial FOC, close API/UI/full acceptance.
  CP-005 remains IN PROGRESS; CP-003A/CP-006 untouched.

## Previous checkpoint — manager-override reconciliation

- New verified PIN audits bind usage sale/customer/tenant and historical manager
  role, actor, reason and paid/used/draw counters. Complete holding audit inventory
  independently matches unpaid draws exactly once and freezes with close inputs.
  Legacy-unbound, missing, duplicate, foreign and mismatched audits fail closed.
- Actual PIN writer authorizes a deposit-funded unpaid draw. Monthly draft/reload
  includes original 50.0000 session base, not deposit-prorated value; current cash
  is only 30.0000. Existing paid draws remain 10.0000 each. Six audit corruptions
  preserve saved draft/audit; September/October approved calculations unchanged.
  Unit coverage checks writer authorization failures/no PIN leakage, replay counters
  and authorization between POS usage time and explicit source append time.
- Fresh selected API **272/272**, three isolated DB suites and zero skips; shared
  **302/302**; API typecheck/build/lint pass. Logs `/tmp/cp005-override-*`.
  Prior temporary cluster/logs were missing on resumption; fresh isolated cluster
  recreated, repository migrations replayed with dotenv disabled. No existing
  application database or schema touched. No browser walkthrough in this checkpoint.
- Reversals/corrections, prepaid-credit spending/refunds/voids, partial package FOC
  and close API/UI/full acceptance remain open. CP-005 is not DONE.

## Previous checkpoint — session-package transfer reconciliation

- Complete append-only transfer and unreversed draw history replays original-buyer
  ownership, transfer remaining quantity/expiry and owner-at-draw. Final owner and
  quantity must match holding inventory. Missing/foreign/duplicate/ambiguous history
  never falls back to current owner. Original purchase value, sellers and ordinal
  economics remain unchanged; transfer history freezes with close evidence.
- Real transfer-service write moves the original paid holding to a new recipient.
  Recipient draws reconcile through persisted holding history and monthly reload.
  Original three 10.0000 draws, uncovered 109.0000 service and 100.0000 current cash
  remain unchanged. Missing/from-owner/quantity/expiry/tied-time/foreign transfer
  corruption refuses without changing saved draft/audit; approved September/October
  hashes remain unchanged. No immutable history was rewritten for negative tests.
- Selected API **269/269**, including three isolated DB suites, zero skips; shared
  **302/302**; API typecheck/build/lint pass. Unit tests also cover transfers both
  before and after draws and no-draw transfers. Logs `/tmp/cp005-transfer-*`.
- Manager overrides, reversals/corrections, prepaid-credit spending/refunds/voids,
  partial package FOC and close API/UI/full acceptance remain open. CP-005 not DONE.

## Previous checkpoint — package tender reconciliation

- Complete sale-level PACKAGE payment inventory matches verified draw count and
  covered service gross, using POS residual-cent allocation after voucher discount.
  SalePayment has no holding link; no individual payment-to-holding mapping is
  invented. Zero-price coverage still requires explicit zero tenders. Verified
  PACKAGE tenders are excluded from fresh external cash operations.
- Monthly payment records must exactly match complete sale payment inventory.
  Tender inventory is frozen with close evidence. Isolated DB draft/reload accepts
  three package tenders with current cash unchanged at 100.0000. Missing, altered,
  gateway-linked, cash-relabeled, credit-relabeled and month-omitted tenders refuse
  without modifying saved draft/audit. Prior approved September/October remain
  unchanged; December aggregate overclaim still writes no close/audit.
- Selected API **265/265**, including all three isolated DB suites, zero skips;
  shared **302/302**; API typecheck/build/lint pass. Logs `/tmp/cp005-tender-*`.
  Unit cases cover residual cents, mixed cash, zero tenders, duplicate/foreign/
  negative/fractional-cent payments and unsupported evidence. Existing authorized
  disposable cluster identity verified at port 55485/database payroll_close_test.
- Transfers, overrides, reversed/corrected histories, prepaid-credit spending,
  refunds/voids, partial package FOC and close API/UI/full acceptance remain open.
  This is not CP-005 completion or application activation.

## Previous checkpoint — monthly redemption integration

- Internal monthly loader now wires independently verified usage-sale coverage and
  full holding history for original-owner unreversed paid-session draws. Exact
  current-month operational/capture rows must match; no previous-month redemption
  bases or cash are added. Ordinary service bases and units use uncovered quantity;
  fully covered service lines must not have ordinary source captures.
- Isolated DB November draft/reload verifies three 10.0000 package draws, one
  uncovered 109.0000/1-unit service, and 100.0000 current cash. Read-only corruption
  tests reject omitted monthly redemption captures, full original-line economics,
  ordinary captures on fully covered lines and unsupported reversal sources.
- December aggregate overclaim still refuses with no close/audit rows. Approved
  September/October calculation hashes remain unchanged. The unrelated live checkout
  FOC shape fixture was moved to January 2027 outside these tested monthly inventories;
  missing-currency refusal was preserved, not relaxed.
- Selected API **260/260** (three isolated DB tests, zero skips), shared **302/302**;
  API types/build/lint passed. Logs `/tmp/cp005-monthly-*`. Prepaid tenders, transfers,
  overrides, corrections/reversals, credit spending/refunds/voids and partial package
  FOC remain blocked. Monthly redemption support is not full CP-005 acceptance.

## Previous checkpoint — multi-holding PostgreSQL acceptance

- Extended isolated acceptance using a second independent package purchase and real
  collection/draw/redemption capture writers. Two holdings cover two units of one
  three-unit service line; one remains uncovered. Both individual holding histories
  verify, but shared coverage of two against one is refused. Results agree after
  committed JSONB reload. Missing-capture states are checked before real capture;
  immutable evidence is never removed or rewritten to manufacture a negative test.
- Blocked November monthly close writes neither draft nor audit; approved September
  and October calculation hashes stay unchanged. Monthly integration is not enabled.
- Selected API **260/260**, including three isolated DB tests with zero skips; shared
  **302/302**; API types/build/lint passed. Logs `/tmp/cp005-multiholding-*`.
- Previous disposable data directory was absent on resume. Created a fresh isolated
  `/tmp/cp005-postgres-*` cluster and applied repository migrations with dotenv
  disabled and explicit test URL. No application database or schema was changed.

## Previous checkpoint — cross-holding sale coverage

- Added `apps/api/src/services/payroll-close-sale-coverage.ts`: salon-wide verified
  owner/manager only, shared tenant source lock, unpaged operational usage inventory,
  complete per-holding replay, matching source/usage records and cumulative covered/
  remaining service quantities. Unsupported kinds/lifecycle and omissions fail closed.
- Focused unit tests cover two independently valid holdings sharing one service line,
  aggregate overclaim refusal, missing/duplicate/foreign evidence, zero usage and
  authorization. Multi-holding real-writer DB acceptance is still pending.
- Isolated DB acceptance now verifies real draw/capture sale coverage and persisted
  reload; the existing monthly workflow gate and frozen September equality still pass.
- Selected API close/source/session tests **260/260**, including three isolated DB
  tests with zero skips; shared **302/302**; API types/build/lint passed. Logs:
  `/tmp/cp005-coverage-*`. Monthly wiring and supported uncovered-base reconciliation
  remain unfinished. This checkpoint does not enable redemption monthly close.

## Authorization and isolation

The user explicitly authorized a new isolated disposable database, including test
migrations and acceptance. Existing databases, production access, activation,
deployment, commits and pushes are not authorized.

A new PostgreSQL 18 cluster was initialized in a fresh `/tmp/cp005-postgres-*`
directory. The local path is recorded in `/tmp/cp005-disposable-cluster.path`.
Database: `payroll_close_test`, user `cp005_test`, loopback TCP port `55485`.
All commands disabled dotenv with `DOTENV_CONFIG_PATH=/dev/null` and explicitly
supplied this isolated database URL. No application `.env` was read or changed.
Only synthetic tenants/users were inserted. Immutable audit fixtures remain in
this disposable cluster; no production data was copied.
The cluster was stopped cleanly after verification; its data directory remains
available for the next CP-005 continuation. No server was left listening.

Applied the existing migrations, then three new migrations:

- `20261029120000_payroll_close_snapshots`: tenant-scoped close snapshots and
  append-only transition audits; immutable approved entitlement, separate payout.
- `20261029121000_payroll_close_audit_atomicity`: deferred matching state/audit
  constraints and previous-hash chain continuity.
- `20261029122000_payroll_close_audit_bounds`: reject orphan future audit entries,
  inconsistent audit scope/revision and unsupported transition kinds.

## Implemented and checked

### Server-owned holding history — October 29

- Internal transaction loader independently queries original holding and purchase
  sale/line, all holding redemptions, collection/payment/outstanding-debt inventory,
  captures, historical rules, transfer/refund evidence. Reconciles original deposit,
  cumulative GST, payment identity/time/amount, original policies and session history.
  Salon-wide authenticated owner/manager and shared tenant lock required. No paging
  or client-supplied records. Current implementation blocks transfers, corrections,
  refunds/reversals, expired draws and unpaid manager-override histories.
- Actual PostgreSQL JSONB reads exposed unstable direct JSON serialization in the
  earlier verifier. Reads now reconstruct writer schema order including nested
  canonical purchase before checking the original hash; no history is rewritten.
  Dedicated reorder/tampering regression added. An outlet-less synthetic usage
  fixture was corrected to use the existing outlet context (the guard was preserved).
- Extended isolated acceptance uses real draw and capture writers: missing snapshot
  refusal, exact remaining ordinals, three-receipt history and persisted reload pass;
  previously approved September calculation remains unchanged after November usage.
  Default November close still rejects redemption workflow intentionally.
- Selected close/source/session tests 256/256, zero skips, including three isolated
  DB tests; shared 302/302; API types/build/lint pass. Logs `/tmp/cp005-history-*`.
  Disposable cluster stopped after verification, synthetic fixtures retained. No
  application database access, schema migration/backfill/activation/deployment.
- This is per-holding loading, not cross-holding sale coverage or monthly close
  integration. Monthly redemption gate remains; unsupported lifecycle paths,
  credit spending/refunds/voids, source corrections and close API/UI remain open.

### Supplied holding reconciliation — October 29

- Redemption verifier now requires original holding coverage rules (no current
  catalogue fallback) and exact initial capture key. Replays per-unit and whole-set
  coverage; rejects missing/duplicate requirements, invalid operational quantities
  and incomplete/excess service sets.
- Added supplied-inventory reconciliation for unreversed draws: historical paid
  limits use receipts strictly before each draw, original lowest-first ordinals
  reconcile to remaining quantity/ranges, and cumulative service coverage cannot
  exceed a sale line. Rejects duplicate/foreign/missing inventory, overcollection,
  ambiguous timestamps and later receipts used to justify earlier unpaid usage.
- Fourteen redemption tests cover original policies, exact residuals, multi-draw
  ordering, aggregate overflow and corruption assertions. Selected close/source/
  session tests: 249 passed, three DB-gated skips, zero failures. Shared 302/302;
  API typecheck/lint/build and whitespace checks pass. Logs `/tmp/cp005-inventory-*`.
- No database access or schema change. Caller must still independently establish
  complete inventory, payment/tax evidence and ownership authorization. Transfers,
  manager overrides and reversals/corrections are not accepted by these checks.
  Default redemption/coverage loader blocks remain. Credit spending/refunds/voids,
  source corrections, close API/UI and full acceptance remain unfinished.

### Redemption evidence foundation — October 29

- Added supplied-record original-session verifier, not enabled operational loading.
  Independently reconciled purchase is a caller prerequisite. Verifies canonical
  purchase/session economics and nonoverlapping original ordinals, session quantity,
  performer splits, tenant/sale/coverage identity, snapshot hash, original policy and
  per-session fixed awards. Source envelopes and historical PACKAGE_REDEMPTION rates
  replay without service/sale fallback. Returned evidence is detached.
- Four tests cover all policies, explicit tender performers, original outlet/seller
  independence, exact residuals, rule-kind separation and 27 corruption cases.
  Focused close/context/source/redemption tests: 248 passed, three DB-gated skips,
  zero failures; shared 302/302; API types/build/lint pass. Logs:
  `/tmp/cp005-redemption-{focused,shared,types,build,lint}.{log,exit}`.
- No DB access or schema change; retained disposable cluster not started. The
  verifier is not proof of complete inventory, paid-session or manager override
  authorization, transfer history, aggregate service coverage, unique ordinals across
  redemptions, or reversal/correction lineage. Default loader retains redemption and
  usage-coverage blocks. These gates and isolated DB acceptance are next, before
  redemption loading can be enabled. No activation/backfill/deployment/commit/push.
  CP-005 remains IN PROGRESS; API/UI/full acceptance still unfinished.

### Cross-month package history continuation — October 29

- Default loader verifies historical sale/outstanding payments and captures against
  original purchase/deposit, receipt ordering, tenant/customer/sale/debt identities,
  exact cumulative GST, source envelopes, historical rates and purchase policy.
  Prior records are frozen verification evidence only: not monthly payment operations,
  cash, base lines, units, fixed awards, group metrics or required staff. Missing,
  contradictory, duplicate or future receipt history fails closed, not reconstructed.
- Unit tests cover FOLLOW_PLAN/EXCLUDE/FIXED with sale-payment and outstanding
  balances, Singapore month boundary, historical payment/capture tampering and stale
  draft detection. DB fixture uses actual source writer with September deposit and
  outstanding receipt, approves September, then records October-boundary 21.80 gross:
  October includes exactly 20 net, one base, zero units and zero fixed award. Stale
  draft approval fails; recalculation and approval succeed; September stays unchanged.
  Explicit post-month test clock preserves the runtime month-end approval gate.
- Focused close plus tenant-context 245/245, zero skips (three isolated DB tests);
  selected source/rate/collection/loader regressions 49/49; shared 302/302; API types,
  build and lint passed. Logs: `/tmp/cp005-crossmonth-*.{log,exit}`. Selected suite
  scope differs from earlier checkpoint counts; no broader acceptance is implied.
- No schema/backfill/application DB access/activation/deployment/commit/push.
  Disposable DB stopped, synthetic fixtures retained. This is not cross-month
  payment route/UI/POS acceptance. Future receipt history remains blocked; usage,
  credit spending, refunds/voids, corrections and close API/UI/full acceptance remain.
  CP-005 remains IN PROGRESS.

### Same-month outstanding package continuation — October 29

- Package balance collections now accept independently inventoried same-month
  OUTSTANDING_PAYMENT receipts after original SALE_PAYMENT deposit. Outstanding
  payment, sale and debt tenant/customer/sale identities and outstanding ID must
  reconcile. Receipt source/amount/time/currency must match independent normalized
  payment inventory, never capture-asserted cash. Original minimum deposit,
  same-month history, ordering, GST replay, policy/rates and once-only award remain.
- DB fixture writes actual debt/outstanding-payment rows and invokes existing
  collection/source writer: 76.30 outstanding receipt contributes 70 net, zero units
  and zero repeated fixed award; stale deposit draft approval fails, recalculation
  and persisted approval pass. Catalogue edits cannot replace original settings.
  This is synthetic historical persistence acceptance, not end-to-end outstanding
  payment route/UI/POS acceptance or cross-month capture verification.
- Unit tests cover all sale modes, missing/foreign/mismatched debt/payment scope,
  source amount/time, missing capture, changed debt evidence and first-deposit/
  cross-month guards. Focused plus tenancy 271/271, zero skips (three isolated DB
  tests); related regressions including loader 133/133; shared 302/302; API types/
  build/lint passed. Logs: `/tmp/cp005-outstanding-*.{log,exit}`.
- No schema change/backfill/application DB access/activation/deployment/commit/push.
  Disposable DB stopped, evidence retained. Cross-month history, usage/credit
  spending/refund/void loading, corrections and close API/UI/full acceptance remain
  unfinished; CP-005 remains IN PROGRESS.

### Same-month package instalment continuation — October 29

- Supports original package deposits and additional settled SALE_PAYMENT receipts
  only when purchase and all package collection history are in the requested month.
  Independent monthly inventory must exactly match relevant receipt history;
  ambiguous creation times, backwards occurrence, foreign/currency/sale mismatch,
  missing payments/captures and unsupported historical/outstanding receipts block.
- First receipt must meet original minimum deposit rounded UP to a cent. This
  bounded slice deliberately refuses split deposits whose first receipt is below
  threshold, even if later receipts meet it. Each capture reconciles receipt net,
  original seller shares/policy and historical rates; units/fixed award appear only
  on first collection, subsequent fixed captures explicitly carry zero award.
- Synthetic DB fixture uses actual collection/source writer and immutable original
  holding: 32.70 deposit contributes 30 net and original 12.34 fixed award; 76.30
  later receipt contributes 70 net and zero repeated units/award. New receipt
  invalidates deposit draft approval; recalculation and persisted approval succeed
  despite current catalogue settings edits. Not end-to-end POS/outstanding/browser
  acceptance and not historical/cross-month payment verification.
- Focused plus tenancy 267/267, zero skips (three isolated DB tests); related
  regressions including loader 129/129; shared 302/302; API types/build/lint passed.
  Logs: `/tmp/cp005-instalment-*.{log,exit}`. Unit checks include upward rounding,
  all sale policies, missing/foreign/incomplete/ambiguous history, GST tampering,
  unsettled gateway payments and repeated units/award rejection.
- No schema change/backfill/application DB access/activation/deployment/commit/push.
  Disposable DB stopped with fixtures retained. Cross-month/outstanding package
  loading, usage/credit spending/refund/void, corrections and close API/UI/full
  acceptance remain unfinished; CP-005 remains IN PROGRESS.

### Full package-purchase continuation — October 29

- Default loader independently inventories package holdings and requires canonical
  immutable purchase snapshots. Original grant, sale/line/package/customer/outlet/
  date, tenant, net/tax/gross, session residuals, sellers and commission settings
  reconcile without current catalogue fallback. Only a fully collected single
  SALE_PAYMENT receipt is supported; partial/multiple/absent receipts remain blocked.
- Captured PKG_SALE seller bases/units, category, mode and fixed amounts reconcile
  against original FOLLOW_PLAN/EXCLUDE/FIXED policy. Fixed award is once per sale
  line, never multiplied by purchased quantity. Historical PACKAGE_SALE rules are
  replayed as of capture, excluding later-published rules and service fallbacks.
- Synthetic historical DB receipt uses actual collection/source writer plus
  original holding snapshot: missing-evidence rollback, immutable rewrite rejection,
  catalogue/settings-edit independence, net cash 100, fixed award 12.34, default
  calculation and persisted approval pass. This is not end-to-end package checkout,
  deposit/instalment or browser acceptance. Units and session grant are checked
  against original operational evidence, not reconstructed catalogue history.
- Unit coverage includes wrong/foreign/duplicate/missing holdings, changed grant,
  economics, policy, units, fixed amount and historical rate; exact seller residuals,
  fixed award once despite multiple units, stale approval, partial/multiple/absent
  collections and missing capture. Focused plus tenancy 265/265, zero skips (three
  isolated DB tests); related regressions including loader 127/127; shared 302/302;
  API types/build/lint passed. Logs: `/tmp/cp005-package-*.{log,exit}`.
- No schema change/backfill/application DB access/activation/deployment/commit/push.
  Authorized disposable DB stopped, fixtures retained. Package deposits/instalments,
  usage/credit spending/refund/void loading, corrections and API/UI/full acceptance
  remain unfinished. CP-005 remains IN PROGRESS.

### Value-purchase collection continuation — October 29

- Default loader inventories original immutable value holding purchase snapshots
  separately from payroll captures. Sale/line/item/tenant, paid net, credit amount
  and seller shares must reconcile. Captured VP_SALE bases use collected net cash,
  never granted bonus credit. First collection receives original units; subsequent
  external instalments receive zero units. Ambiguous creation-time ties fail closed.
- Replays independent historical STORED_CREDIT_SALE rules available at capture;
  service legacy rates cannot substitute. Per-seller bases/units, FOLLOW_PLAN mode,
  no fixed commission, null category and original snapshot evidence are checked and
  hashed. Missing snapshots are unavailable; no reconstruction/backfill is attempted.
- Synthetic historical DB fixture uses the actual collection/source writer and
  persisted holding snapshot: missing purchase evidence rolls back close, snapshot
  rewrite fails, catalogue edits leave 100 net activity/cash unchanged despite 150
  granted credit, and default calculation/approval succeeds. Existing ordinary/FOC
  checks remain. Unit coverage includes later instalments, wrong/foreign/duplicate
  holdings, changed economics/sellers/base/units/rate/mode, seller residuals and stale
  approval. This does not establish end-to-end value checkout, outstanding-payment
  creation, customer ownership history or complete browser acceptance.
- Checks: focused plus tenancy 260/260, zero skips (three isolated DB tests);
  related regressions including loader 122/122; shared 302/302; API types/build/lint,
  formatting and whitespace passed. Logs: `/tmp/cp005-value-*.{log,exit}`.
  Only authorized disposable DB used, stopped with data retained. No schema change,
  application DB access, activation, deployment, commit or push. Package purchases,
  usage/credit spending/refund/void loading, source corrections and API/UI remain
  unfinished; CP-005 remains IN PROGRESS.

### FOC operational-economics continuation — October 29

- Migration `20261029140000_sale_line_payroll_economics` adds nullable original
  checkout economics to sale lines. Database trigger prevents rewriting/removing
  populated evidence or moving its line/tenant/sale identity. Checkout writes it in
  the sale transaction, independently from the payroll source event. Legacy rows
  remain null; no current-catalogue reconstruction or backfill is authorized.
- Default loader supports wholly complimentary service lines using independent
  original nonmember list price, quantity, date/identity/category and performer
  shares. It checks zero tax and source FOC type/base/units plus historical FOC
  rule/default provenance. Two units at 492 yield 984 activity, 49.20 default
  commission and zero external cash. Zero-price products, mixed package/value usage,
  prepaid and unsupported reversal/refund workflows remain blocked.
- DB acceptance uses actual createSale to verify snapshot writing/immutability and
  catalogue-edit independence; a separate synthetic historical FOC receipt verifies
  default monthly loader missing-snapshot/capture rollback, calculation, stale
  approval, recalculation and approval. It does not claim end-to-end backdated POS
  checkout or full payroll/browser acceptance. Unit checks cover invalid identity,
  category/tax/rate/base/quantity, capture-only price assertions, multi-performer
  exact residuals and departed staff. Original list price remains checkout-attested,
  not independently reconstructed catalogue history.
- Focused plus tenancy **241/241**, zero skips, including three isolated DB tests;
  related regressions **78/78**; shared **302/302**. API types/build/lint/schema pass.
  Logs/exit markers `/tmp/cp005-foc-{combined,regression-focused,shared,types,build,lint,schema,migrate}.{log,exit}`.
  Broad sale.service suite was attempted against intentionally unreachable DB and
  failed DB setup/cleanup; it was not redirected to retained immutable fixtures.
  Earlier acceptance attempt rejected collection metadata without a positive tender;
  actual FOC checkout test now correctly omits collection metadata. Only authorized
  disposable DB migrated/used, then stopped; data retained. No activation/deployment.

### Ordinary rate-provenance continuation — October 29

- Operational source writer now retains evaluation time, item/category, legacy
  staff rate and selected fallback rate/source/rule identity for every credited
  staff line. Default ordinary loader loads the independent append-only rule
  inventory and replays rules with effective dates at occurrence and publication
  dates no later than capture. It verifies item/time/staff/category, rule identity,
  precedence and exact captured fallback. Missing evidence blocks older captures;
  no current staff/catalogue fallback, historical backfill or activation was added.
- Category and legacy staff rate remain immutable operational-writer attestations,
  not independent historical user/catalogue reconstruction. This boundary assumes
  server-owned transactional source creation; it does not authorize source uploads
  or repair historical evidence. Other workflow provenance remains unsupported.
- Tests cover absent/tampered provenance, rule identity and precedence, explicit
  zero, inheritance, department ties, foreign rules, future rules/publications,
  detached snapshots and operation/capture ordering. DB loader acceptance changes
  current staff rate and publishes a later backdated rule, then verifies the
  captured zero rate survives recalculation and approval unchanged.
- Focused plus tenant/schema checks **236/236**, zero skips, including three
  isolated DB acceptance tests; related rule/collection/refund regressions **78/78**;
  shared **302/302**. API typecheck/build/lint passed. Logs/exit markers:
  `/tmp/cp005-rates-{combined,regression,shared,types,build,lint}.{log,exit}`.
  No new migrations. Only authorized disposable DB used, then stopped; data retained.

### Persisted carry authorization continuation — October 29

- New migration `20261029130000_payroll_carry_authorizations` applied only to the
  authorized isolated DB. Immutable tenant-scoped owner approvals carry hashes and
  contiguous revisions; database insert guard verifies active, 2FA-enabled owner,
  tenant and approval timestamp. Initial migration attempt rolled back because users
  have no composite tenant/id unique key; fixed to the existing user primary-key FK
  plus explicit tenant/owner insert guard, resolved the isolated failed attempt and
  applied successfully. No application databases were accessed.
- Internal owner write boundary shares the tenant source/configuration lock with
  close calculation/approval. It rejects manager/staff/unverified owner, outlet,
  cross-tenant, non-writable tenant and approved-month writes; stamps approval
  identity/time/reason itself. All salon staff, including zero/departed balances,
  must appear explicitly in the first opening inventory. Opening approval cannot be
  backdated; it must precede the salon-local first-month boundary. Earlier history
  or a competing opening prevents cutover. This is authenticated owner attestation,
  not proof of reconstructed legacy debt completeness.
- Default loader now reads/reconciles persisted opening and exact carry settlements.
  Supports existing component remap/write-off and exact fallback debt write-off,
  not actual cash debt repayment. Changed balances block stale settlements;
  reasoned owner reauthorization replaces the current revision without deleting any
  earlier evidence. Changes freeze into input hashes and reject stale close approval.
- DB acceptance verifies write races, isolation/permissions, immutable rows, rollback,
  stale balances and repair, and actual default-loader future first-close calculation
  with departed debt from authenticated opening/write-off, without prior-close
  bootstrap. Future month approval remains prohibited until the month ends.
  Loader unit test covers debt/write-off money, stale approval, recalculation and
  approval with persisted-shaped audited records. This is not full first-close
  end-of-month acceptance or full authoritative payroll acceptance.
- Final focused checks: **223/223** plus tenant/schema checks **4/4**, total
  **227/227**, zero skips, including all three isolated DB tests; shared **302/302**.
  API types/build/lint pass; logs and zero exit markers:
  `/tmp/cp005-auth-{combined,shared,types,build,lint,migrate}.{log,exit}`.
  Cluster stopped cleanly after checks; data retained. No close routes/UI activated.

### Authoritative input-loading continuation — October 29

- Internal calculation/approval now default to a server-owned transactional loader.
  Explicit loader injection remains an internal test seam, never HTTP input. There
  is still no public close route or earnings activation.
- First supported slice: ordinary non-FOC service/product operational sale lines,
  recorded non-gateway external payments, outstanding-payment identity checks,
  independent complete month inventories, historical configuration, audit-verified
  preceding approved carry and cross-close source exclusion. Exact-cent cumulative
  collection allocation is replayed against operational purchase tax, not bases.
  Ordinary base amounts, units/types/staff reconcile against sale-line attribution.
  Cash attribution requires historical allocation sellers matching the original line.
- Unsupported package purchase/collection, redemption/value spend, prepaid tenders,
  FOC and refund/void/correction workflows fail closed, including independent usage,
  refund and void inventory without captures. Missing persisted opening cannot become
  zero. This is **not the complete authoritative loader acceptance** in item 1 below;
  package refunds also still lack independent payout inventory, and fallback-rate/
  classification provenance needs expanded operational acceptance before activation.
- New isolated DB acceptance verifies the default loader's ordinary calculation,
  missing-capture rollback without close/audit insertion, historical-profile stale
  approval rejection, recalculation and approved snapshot immutability. It explicitly
  bootstraps a synthetic preceding close, not authenticated opening acceptance.
- API typecheck/build/lint passed. Final focused suite:
  **221/221 passed, zero skipped**, including both opt-in DB tests; shared **302/302**.
  Logs `/tmp/cp005-loader-{combined,shared,types,lint,build}.log`
  and matching exit markers. No schema changes/migrations, existing DB access,
  browser acceptance, activation or deployment in this continuation.

- Explicit supplied opening inventory supports first-close composition without a
  fabricated previous close. Missing evidence still fails closed. Frozen opening
  debt preserves departed staff, stable component keys and ten-decimal fallback
  amounts; no implicit zero or unaudited settlement.
- Supplied carry-settlement evidence validates exact prior balance hashes,
  component mapping/write-off and exact fallback write-off. Revisions and approval
  provenance are frozen. This validates supplied evidence, not owner authenticity
  or an actual cash repayment.
- Scoped statement composition partitions plan/fallback activity, retains separate
  fallback debt, limits plan incentives to assigned outlets, prevents duplicate
  sources and pools fixed awards before rounding once. Low-level plan calculation
  still rejects unpartitioned activity. Calculation version is now `cp-005-v2`;
  old versions fail replay rather than silently changing approved history.
- Approval replays draft statements and checks stored inputs/outputs as well as
  versioned input hash; approval cannot precede calculation.
- Internal store uses authenticated tenant context and tenant source/configuration
  lock, expected revisions, writable-salon and owner-verification checks. No HTTP
  caller can submit a loader or complete payroll inputs because no close write
  route is exposed. A server-owned loader is mandatory; there is no default.
- Database acceptance checks rollback, concurrent calculation conflicts, stale
  input rejection after a locked staff edit, preserved manual amounts, own-data
  reads, manager/owner/outlet/tenant isolation, approved immutability, atomic audits,
  orphan-audit rejection, duplicate payout races and unchanged frozen output after
  payout. It uses a deliberately synthetic loader, **not authoritative cash**.
- Internal owner-only monetary correction posts a linked reasoned adjustment into
  the next open salon-local month; rejects backdating and preserves the original
  approved close. This is not source-base correction capture or complete TC-19.

## Actual checks

- Combined focused API tests: **211/211 passed, zero skipped**, including the
  opt-in isolated database test. Log: `/tmp/cp005-final-combined.log`.
- Shared tests: **302/302 passed**. Log: `/tmp/cp005-final-shared.log`.
- Existing payroll configuration/preview/settings UI regression: **40/40 passed**.
  Log: `/tmp/cp005-final-web-tests.log`. No monthly-close UI exists yet.
- API typecheck/build/lint, shared lint, web typecheck passed. Logs use
  `/tmp/cp005-final-*.log`, with matching `.exit` markers.
- Prisma schema validation, Prettier and Git whitespace checks passed.

Acceptance command from the repository root:

```sh
DOTENV_CONFIG_PATH=/dev/null \
DATABASE_URL=postgresql://cp005_test@127.0.0.1:55485/payroll_close_test \
JWT_SECRET=cp005-test-only NODE_ENV=test RUN_CP005_ACCEPTANCE=true \
node --import tsx --test apps/api/src/services/payroll-close*.test.ts \
apps/api/src/services/payroll-preview-inputs.test.ts \
apps/api/src/services/payroll-correction-period.test.ts \
apps/api/src/services/payroll-package-void.test.ts
```

The DB test checks the exact loopback host, port and database before writing.
Do not point this command at an application database.

## Required before CP-005 DONE

October 31 source-correction slice: real session-attribution reverse/repost now
records occurrence separately from posting, skips approved months, reconciles
close revision/hash evidence and posts no new cash. Guarded acceptance includes
concurrent idempotent retries, stale-draft refusal, recalculation/approval, deferred
future posting, competing approval and invalid-performer rollback, retaining both
original and subsequently approved hashes. Expanded regression: 487 pass / 0 fail /
9 gated skips. This is partial M2 evidence, not acceptance of every correction
family. Follow-up deterministic session cases now cover both approval-first and
correction-first lock orderings: real PostgreSQL blocking is observed before the
first writer is released; stale approval leaves no approval audit or draft
mutation; both cases persist the exact next-month reverse/repost and preserve
prior approved hashes. Other correction/lifecycle combinations and M1 remain open.
Follow-up guarded regression: **489 passed, 0 failed, 9 gated skips** (498 total);
API typecheck/build, targeted lint/format and whitespace checks pass. Evidence:
`/tmp/cp005-ordered-regression.log` and companion quality-check logs/exit markers.

1. Authoritative transactional loaders: independent complete operational inventory,
   settled payment/refund/void provenance/timing, historical allocations/attribution,
   prior/cross-workflow exclusivity, legacy payout exclusion, historical
   configuration, carry, first-close eligibility and authenticated settlements.
   Cancelled authorizations and partial/uncertain settlement remain unsupported.
2. Integrate next-open-period **source-base** correction posting into operational
   captures, with occurrence versus posting dates, idempotency and approval/source
   races. Internal monetary adjustments are not a substitute.
3. Complete opening/settlement API/UI and end-of-month acceptance on top of the
   internal authenticated persistence above; verify component plan-switch mapping
   and approved-month races. Cash debt repayment is unsupported and must fail closed.
4. Monthly-close API and UI with authenticated module/role/outlet boundaries,
   own-data frozen reads, adjustments, calculation/approval and separate payout.
5. Full money reconciliation and transactional acceptance using authoritative
   loaders, API/browser permission acceptance, plan switches, races/rollback,
   immutable approved history and documented performance evidence.

Do not activate the internal store, enable monetary preview or mark CP-005 DONE
solely on the persistence/engine tests above.
