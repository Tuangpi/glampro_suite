# Commission & Payroll decisions

## Partial upfront purchase void evidence — October 30, 2026

- Relax full funding only for the existing preserved, unused/untransferred/unexpired
  NO_MOVEMENT path. Checkout paidAmount must equal surviving external tenders;
  totalAmount must equal original line gross and paymentStatus must agree. Every
  collection still binds one-to-one to a surviving upfront payment, replays exact
  allocations and verifies captures/reversals. Enforce captured package deposit
  thresholds even when a package line has no collection. No debt becomes cash.
- The writer refuses voids after outstanding payments, then deletes the outstanding
  and cascades payment children on successful void. Surviving collection/capture
  evidence alone cannot substitute for deleted payment operations. Continue to
  reject OUTSTANDING_PAYMENT collections; do not relax writer restrictions or infer
  historical funding from status. Real-writer acceptance remains outstanding.

## Status and authority

Adopted for local implementation October 27, 2026 under the user's delegation to
use recommended decisions. These are policy/design decisions, not claims of
implemented behavior or production activation. Future conflicts must be recorded.

## SRS decisions and open points

### CP-005 mixed ordinary/purchase no-movement void loading (October 30, 2026)

- Extend the independently reconciled purchase-void path to ordinary service/product
  and evidenced FOC lines on the same sale. Verify ordinary SALE_LINE and purchase
  COLLECTION inventories separately, with exact original/reversal pairing and
  historical economics/rates. Cash follows collection sellers independently.
- Retain explicit NO_MOVEMENT confirmation, preserved unused/untransferred/unexpired
  purchase snapshots and independent journals, complete upfront external funding
  and original package deposit policy. No historical backfill or VOID-status fallback.
- Prior purchase-only/mixed-void blanket gates below are superseded only for this
  narrow path. Real-writer and broader lifecycle acceptance remain deferred; M1 open.

### CP-005 purchase-void evidence preservation (October 30, 2026)

- Confirmed prospective NO_MOVEMENT voids preserve package/value-package holdings,
  including original payroll purchase policy, in the existing audit journal before
  deletion. Cash confirmation binds that evidence hash in the same transaction.
  No retry backfill, missing-history inference or new schema. Existing void eligibility
  does not depend on whether legacy holdings have usable payroll snapshots.
- Snapshot validation is only a prerequisite: require matching tenant/sale/actor/
  reason/times, exact hash, complete original purchase-line identity, deleted holdings,
  full remaining balances and original purchase verifiers. It is not independent
  grant/removal, settlement, collection or reversal reconciliation.
- Purchase monthly loading remains gated until credit GRANT/REMOVAL and session
  valuation purchase/PURCHASE_VOID records independently agree with preserved
  snapshots and complete collection/reversal inventories. Application audit records
  are not a DB-enforced immutable evidence store. Real-writer acceptance is deferred.

### CP-005 ordinary no-movement void loading (October 30, 2026)

- Supersedes the ordinary-void blanket gate only for service/product-only sales with
  prospective explicit manager NO_MOVEMENT confirmation, unchanged operational hash,
  verified original line economics/rates and exact actor/reason/key-backed reversals.
  Existing independently evidenced FOC economics may verify FOC originals too.
- Retain original collection cash in its original month. No void cash movement is
  inferred from status or negative bases. Prior originals are lineage only; current
  captures must match independent monthly inventory. Month-straddling voids refuse.
- Purchase/prepaid/mixed voids remain gated. Operational purchase void deletes
  holdings, so existing holding-dependent verifiers cannot simply accept VOID status.
  No historical attestation backfill, returned-money writer or migration introduced.
  Audit journal remains application evidence, not DB-enforced immutable settlement.

### CP-005 independent ordinary refund cash attribution (October 30, 2026)

- Supersedes the differing seller/performer refusal below: original source shares
  verify commission reversal; independently evidenced collection sellers allocate
  cash. The authoritative refund loader emits both, never derives sellers from bases.
- Preserve each collection allocation's ID/net/shares and split separately before
  summing cash by seller, avoiding residual movement when receipts are combined.
  Require unique IDs and exact net totals; reconcile overlapping current-month
  collections, sellers, line and outlet identities. Snapshots freeze both dimensions.
- Optional cash attribution preserves existing supplied-record same-share fixtures;
  the authoritative loader always supplies explicit verified allocation evidence.
  No DB schema/writer changes. Transactional acceptance remains deferred; M1 is open.

### CP-005 ordinary refund authoritative loading (October 30, 2026)

- Admit only fully paid upfront money-funded ordinary service/product refunds with
  independent SaleRefund payouts, complete tenders/collections/line inventory,
  original economics/rate provenance and exact actor/reason/key-backed reversals.
  No cash inferred from negative bases. Preserve collection-month cash; subtract
  refund net in its own month. Refuse month-straddling reversal transactions.
- Current refund contract uses the same shares for source bases and cash. Until
  separate source/cash attribution is represented and verified, refuse service
  refunds whose sellers and performers differ. Also refuse FOC, prepaid funding,
  outstanding balances and missing historical payout evidence; do not normalize them.
- Prepaid refund helper payroll captures are not independent settled-payout evidence.
  Their existence does not authorize monthly cash loading or M1 acceptance.

### CP-005 explicit expiry journal replay (October 30, 2026)

- Supersedes unchanged-expiry restrictions only for explicit EXPIRY_CHANGE evidence.
  Replay starts at GRANT expiry, requires actor/reason, unchanged owner/sharing/
  balance and no sale, and reconciles final holding expiry. Other event kinds cannot
  silently change expiry. Missing/ambiguous evidence refuses.
- Spends use historical effective expiry; restorations use their own replayed expiry
  without retroactively validating the original spend. Transaction-start ledger
  timestamps cannot cross recorded spend/restore/transfer appends.
- No expiry writer/UI or inferred history. Expiry-specific tests and transactional
  acceptance remain deferred under implementation-first approval; M1 stays open.

### CP-005 prospective credit void cash and full-credit funding (October 30, 2026)

- Extend void requests compatibly with optional `cashDisposition: NO_MOVEMENT`.
  The checkbox starts unchecked. Only an explicitly authenticated manager/owner
  attestation creates a cash-disposition audit in the successful void transaction.
  No confirmation on retries, no legacy backfill, no assertion of returned money.
- Bind the audit to post-void sale/lines, tenders, collections, redemptions and empty
  refund/later-payment inventories via an exact JSON hash. Exclude sale.updatedAt,
  which retry serialization can touch without changing money. Historical actor role,
  reason and operational timestamp are retained. Audit records use the existing
  application journal, not a new DB-enforced immutable table; no independent physical
  cash or provider settlement verification is claimed.
- Credit service/product sale void loading reconciles every original and exact
  reversal, independently verified holding restorations and explicit cash confirmation.
  Original external cash stays in its collection month; restored credit adds none.
  Freeze confirmation with monthly inputs. Unconfirmed/returned/uncertain cash,
  unsupported ordinary/purchase/mixed-session voids and month-boundary-straddling
  void transactions still refuse. This is implementation, not real-writer acceptance.
- Prospectively freeze full-credit funding inside immutable sale-line economics:
  complete distinct positive non-gateway PREPAID_CREDIT tenders must equal the
  settled SGD service/product receipt total. Match the snapshot independently on
  loading before assigning zero ordinary external base. VP_SPEND keeps original
  purchase-ratio economics. No mixed-tender inference or repair of missing history.

### CP-005 historical shared-credit access (October 30, 2026)

- Replay explicit SHARING balance transitions alongside GRANT/SPEND/TRANSFER;
  unchanged owner, amount and expiry plus actor/reason and no sale are mandatory.
  The append-only balance journal is the holding consent evidence. Membership
  alone never grants access, and legacy familyId/opening evidence is not inferred.
- Independently load complete membership events and current membership for every
  historical owner/spender, plus referenced families. Replay from no membership;
  validate tenant, identity, transitions, actor/reason, family existence and final
  membership. Member creation may precede event append within its transaction;
  ambiguous equal-time changes for one customer refuse rather than sorting by ID.
- Shared spends retain the holding owner in the balance journal but name the
  consuming customer in redemption/sale evidence. Both must belong to the consented
  family at ledger and usage time, with continuous access between those times.
  Owner membership departure withdraws consent; later rejoin cannot revive it.
- Freeze loaded consent/membership/family evidence with monthly inputs. Consent-only
  changes invalidate drafts; approved history stays unchanged after later membership
  edits. Sharing adds no cash/base and never changes original purchase ratios/sellers.
- This removes the sharing-only restriction, not the remaining M1 lifecycle gates:
  restorations, refunds/voids, expiry edits, mixed session-package usage, spend-sale
  instalments and full-credit paid lines lacking allocation evidence remain open.

### CP-005 private credit ownership replay (October 30, 2026)

- Original purchase buyer/sellers and paid-to-credit economics remain immutable
  after transfer. Spend ownership comes from complete independent balance replay,
  not today's owner. A transfer creates neither fresh cash nor a payroll base.
- Match every private ownership ledger transition to exactly one immutable transfer
  audit and consume every audit. Reject changed balances, tenant/holding/owner/actor/
  reason/expiry, missing evidence and ambiguous ordering. Ledger transaction-start
  timestamp may precede audit append; audit cannot cross the next ledger operation.
- Freeze transfer evidence with full holding history. A transfer-only change can
  invalidate an open draft; approved statements remain immutable. No backfill.
- This enables only private ownership transfers. Family membership, consent/sharing,
  restoration/refunds/voids and expiry edits remain gated pending separate replay.

### CP-005 private-credit monthly boundary (October 30, 2026)

- The internal monthly gate now admits only the already reconciled settled private
  service/product/FOC credit-sale subset, after exact independent month inventory
  comparison. Freeze complete sale/holding evidence with inputs so later activity
  invalidates drafts but cannot rewrite approved statements. No earnings activation.
- Credit tenders are excluded only by verified payment ID, never by payment method
  alone. Original purchase external net counts as cash in its collection month;
  subsequent tender face value creates no cash. Ordinary external allocations,
  purchase-ratio VP_SPEND and immutable FOC economics remain distinct.
- Multiple holdings of the same catalogue package may share a spend receipt.
  An apparent sibling source must match an independent operational redemption on
  another holding; complete sale reconciliation still validates every holding.
- Full-credit paid lines with unavailable ordinary allocation and unsupported
  lifecycle/instalment/package combinations continue to refuse. This supersedes
  the earlier blanket monthly gate, not the remaining readiness/release constraints.

### CP-005 private credit sale allocation boundary (October 30, 2026)

- Sale-level reconciliation separately proves original private-credit holding
  history, complete spend captures and external collection allocations. Ordinary
  paid-line bases match independently allocated external net; VP_SPEND retains
  the original holding paid-to-credit ratio. FOC remains frozen full-list-price
  activity. Credit tenders are never external collection or fresh cash.
- Do not infer zero ordinary bases when checkout recorded unavailable external
  allocation evidence. Fully credit-funded paid lines still refuse. This slice
  supports fully settled service/product receipts only; package combinations,
  later outstanding payments, transfers/sharing and refund/void history still refuse.
- Internal sale readiness does not open the monthly prepaid gate or activate
  earnings. Monthly integration must independently compare month inventories and
  freeze sale evidence, and acquire prepaid advisory lock BEFORE tenant lock at
  the outer close transaction boundary (including stored calculate/approve), not
  acquire prepaid inside an already tenant-locked close transaction.
- Real writer evidence is required for unsupported paths; no backfill, application
  schema/database changes, inferred tender-line proportions or current-price fallback.

### CP-005 restored sessions and partial FOC (October 30, 2026)

- Replay draw, restoration and transfer timestamps against original grants. Restored
  ordinals become available for subsequent draws without changing original per-session
  residuals. Ambiguous ordering, duplicate restoration or inconsistent counters refuse.
- A session void is not a sale void or cash refund. Retain original receipt coverage
  and reverse only the latest attributed session source in the reversal month, with
  independent operational void snapshot and authenticated request audit. New audits
  retain request/revision and historical role for replay; legacy-unbound voids refuse.
- Partial package FOC uses the original immutable checkout list price multiplied by
  uncovered units only. Independently verified package coverage must exactly match
  the checkout snapshot; do not infer covered units from a captured payroll base.
- The close router and management component are implementation groundwork, deliberately
  unmounted. Credit lifecycle, opening/settlement UI, live HTTP workflow acceptance
  and full CP-005 performance/browser checks remain required before activation/DONE.

### CP-005 monthly correction reconciliation (October 30, 2026)

- Complete correction snapshot inventory is independent of captured source IDs/dates.
  Reconcile all affected usage sales and full holding chains before selecting monthly
  replacements/reversals. Conservative full history may block an earlier draft when
  later history is incomplete; do not infer or backfill missing evidence.
- Match corrections by immutable source revision key as well as redemption ID:
  multiple corrections to one redemption are distinct operations. Only current-month
  lines enter payroll; preceding sources outside the month are lineage only.
- Zero-money reversal evidence comes from verified operational correction snapshots,
  preserved original purchase/session economics and correction semantics, never from
  negative bases alone. Feed it through both cash and final-input reconciliation.
  Corrections change attribution, not cash, session inventory or saved approved months.
- Internal monthly correction support is now verified; this supersedes the earlier
  holding-history-only gate below. Session voids, refunds, credit lifecycle and other
  unsupported workflows remain closed; no production activation is authorized.

### CP-005 redemption correction-chain history (October 30, 2026)

- Reconcile complete holding attribution history separately from original session
  consumption. Every contiguous correction links the previous snapshot, preserves
  original purchase, ordinals, coverage and valuation, and has exactly one replacement
  source and exact reversal of the preceding source. Independently verify actor,
  reason, idempotency request hash and source-time rate selection. No latest-only
  substitution, inferred missing revision or source-history rewriting.
- The correction writer hashes the submitted request before canonicalizing performer
  order. Retain that original request in new correction snapshots so JSONB reloads
  can verify hashes without guessing ordering. Existing corrections without retained
  request evidence remain unavailable; this does not authorize backfill.
- Holding-history verification does not enable monthly correction/void inputs.
  Monthly operational inventory, original-source lineage and independent zero-money
  reconciliation must be integrated before those close gates open. Session voids,
  refunds, credit lifecycle and other unsupported workflows stay blocked.

### CP-005 manager-override reconciliation (October 30, 2026)

- POS must bind verified manager PIN authorization to the tenant/holding/customer
  and usage sale. Freeze verified manager role, actor, reason and paid/used/draw
  quantities in its audit, never PIN material. Current manager role or PIN hash is
  not historical authorization evidence. Existing unbound audits remain unavailable;
  do not infer matches, backfill approvals or rewrite source history.
- Complete holding override audit inventory must match unpaid draws exactly once,
  including exact paid/used counters from chronological receipt/session replay.
  Reject orphan, duplicate, foreign, unnecessary or mismatched approvals. Freeze
  audit inventory with monthly close evidence; override creates neither cash nor
  changed purchase value, seller attribution or session ordinals.
- POS assigns usage time before PIN verification. Approval time must fall between
  that draw's usage time and source append time, after any prior draw. Source
  appends explicitly capture application time: PostgreSQL `now()` defaults to
  transaction start and cannot establish PIN-to-capture ordering. Existing evidence
  is not rewritten. Reversals/corrections and other unsupported lifecycle remain gated.

### CP-005 session-package transfer reconciliation (October 29, 2026)

- Replay complete append-only session transfer and unreversed draw history from
  original purchase owner, not current customer alone. Each transfer must name the
  previous owner, a different recipient, actor/reason, exact remaining quantity and
  unchanged expiry. Each draw belongs to the owner at its timestamp; final owner
  and quantity must match the holding. Reject ambiguous equal timestamps rather
  than ordering by arbitrary IDs. Freeze transfer evidence with holding history.
- Transfers do not revalue purchases, change sellers, create fresh cash or reset
  original session ordinals/paid-session gates. Current actor roles are not a
  substitute for historical append-only transfer evidence. Existing transfer writer
  remains responsible for transaction-time actor/customer checks and locking.
- This enables only ownership-reconciled unreversed paid-session histories. Manager
  overrides, corrected/reversed histories, credit spending and refunds remain gated.

### CP-005 package tender reconciliation (October 29, 2026)

- SalePayment does not persist a holding ID. Match the complete sale-level PACKAGE
  tender count to verified draw count and aggregate gross to covered service units,
  using POS first-unit residual-cent allocation after voucher discount. Do not invent
  a payment-to-holding pairing. Zero-price covered units still require zero tenders.
- Match complete sale payment inventory to exact current-month payment rows; freeze
  both inventories. A matched PACKAGE tender is not fresh cash and is excluded from
  external payment operations. Missing/unmatched/duplicate/negative/gateway-linked
  tenders and prepaid-credit spending remain unavailable. This does not authorize
  transfers, overrides, corrected/reversed histories or partial-package FOC.

### CP-005 scoped statements and internal persistence (October 29, 2026)

- Compose one statement from disjoint assigned-outlet plan and out-of-scope
  source-rate fallback calculations. Plan incentives exclude fallback activity;
  salary/collection/adjustments appear once. Pool FIXED source awards across both
  paths before cent rounding; preserve reserved component identities once.
  Keep fallback debt separate from plan earnings; no silent debt loss when fallback
  activity disappears. Calculation version changes to `cp-005-v2`; incompatible
  historical replay fails closed, not silently recomputed under changed semantics.
- Supplied audited settlements may map/write off component carry or explicitly
  write off exact fallback debt, bound to the resolved prior staff-balance hash.
  No inferred cash settlement, partial write-off or unauthenticated public upload.
- Internal close persistence shares tenant source/configuration lock and optimistic
  revision checks. Append complete states with chained hashes atomically; approved
  entitlement and audit rows are immutable. Separate payout records change only
  payout/revision. DB constraints reject state-only or orphan audit commits.
  Loader is injected only by server code; no default or public write route exists.
- Owner-only monetary correction may append a linked adjustment to the next open
  month, preserving the original approved snapshot and rejecting backdating. This
  does not replace immutable source-base correction capture/operational integration.
- Isolated synthetic-loader DB tests verify persistence, not authoritative cash
  loading or complete CP-005 acceptance. See `CLOSE_ACCEPTANCE.md`.

### CP-005 disposable database authorization (October 29, 2026)

- User explicitly authorized CP-005 work on a **new isolated disposable test
  database**, including test migrations and acceptance. This supersedes the all-DB
  pause only for that environment. Existing databases, production DB access,
  activation and deployment remain unauthorized.
- Created a fresh local PostgreSQL cluster on loopback port 55485, database
  `payroll_close_test`, with dotenv disabled and explicit CLI/runtime URLs. Never
  reuse application database credentials or existing cluster data. The isolated
  cluster path is saved locally at `/tmp/cp005-disposable-cluster.path`.

### CP-005 first-close opening carry and approval integrity (October 29, 2026)

- A first close may consume explicit audited opening inventory instead of a
  fabricated preceding close. Require tenant/month/timezone, exact salon-local
  effective boundary, positive revision, complete-inventory/first-close assertions,
  owner approval identity/reason/time and JSON provenance. Approval must be no later
  than the effective boundary. No preceding record plus no opening remains unavailable;
  supplying both conflicts, even if the preceding record is unapproved.
- Opening debt retains original stable component keys and nonpositive four-decimal
  bases/units or exact ten-decimal fallback commission. Reject positive balances,
  repeated staff/components and missing evidence. Explicit reviewed empty inventory
  permits zero; missing inventory never implies zero. Keep departed debt staff and
  freeze sorted detached evidence for stale approval. Unmapped debt still blocks
  calculation; no implicit plan-switch settlement or write-off is added.
- These records are internal supplied facts, not proof of eligibility, complete
  historical debt or authenticated approval. A trusted locked loader must establish
  these facts before operational use. No cutover, DB operation or activation occurs.
- Before approving a draft, replay statements from current resolved inputs and
  compare both stored inputs and outputs, in addition to the versioned input hash.
  Reject altered snapshots and approval timestamps preceding calculation.

### CP-005 ordinary returned-void cash extension (October 29, 2026)

- Extend the bounded RETURNED contract below to fully returned ordinary service/
  product sales. Require independent settled payouts and full original external-cash
  allocation evidence per original sale line, including net/GST/gross, historical
  shares and evidence revisions. Match SERVICE/PRODUCT to SVC/PRD original bases,
  sale-line source identity and exact reversals. No payout is inferred from bases.
- Require complete supplied original/reversal inventory. A returned void may use
  ordinary SALE_LINE or package COLLECTION sources, not a mix. Existing refund/
  void conflicts remain unavailable. Partial returns, cancelled authorizations and
  uncertain settlement remain unsupported; NO_MOVEMENT is not inferred from them.
- Current collection overlaps must match sale, item type, sale-line identity,
  net/GST/gross, outlet and historical staff shares. Subtract returned net once;
  preserve same-month positive cash so full returns net to zero. Freeze all supplied
  evidence for stale approval; retain departed staff and negative carry.
- This supersedes only the earlier ordinary-return exclusion. Settlement timing/
  authenticity, historical allocation provenance, complete cash inventory and
  prior/cross-workflow payout exclusivity still require authoritative loaders.
  No loader, operational write, payout, database operation or activation is added.

### CP-005 fully returned collection void cash (October 29, 2026)

- Accept RETURNED void disposition only with independent settled payout identities/
  tenders, exact net/GST/gross and complete original package/value-package collection
  allocations. Each collected allocation must reconcile fully to original source
  bases and historical staff splits; exact source reversal checks remain mandatory.
- Subtract returned net cash once in the requested void month. Preserve original
  same-month positive collections, so full collection/return nets to zero. Validate
  overlapping current allocation identities and amounts; retain prior-month lineage
  independently. Require known cash outlet and freeze payout/allocation revisions.
- This bounded contract excludes ordinary-sale returned voids, partial returns,
  mixed unsupported activity and cancelled authorizations/unsettled cash. Those
  remain unavailable, not presumed refunds or zero. Independent settlement timing,
  original sale-line identity for historical allocations, complete money inventory,
  and prior/cross-workflow payout exclusivity remain trusted-loader obligations.
  No actual payout, void write, database access or operational activation is added.

### CP-005 no-cash sale voids (October 29, 2026)

- Existing sale voids reverse payroll captures but do not independently record a
  payout. Neither VOID status nor negative commission bases proves money returned.
  Accept unchanged cash only with explicit independent NO_MOVEMENT disposition,
  zero net/GST/gross and frozen operational/cash-disposition revisions.
- Require complete supplied SALE_LINE/COLLECTION original and reversal identities
  for the sale, exact source reversal validation, sale/outlet scope and chronological
  month evidence. Preserve same-month original collections; do not erase external
  cash merely because operational sale activity was voided.
- Conflicting refund/no-cash claims fail closed. Returned, cancelled-settlement or
  uncertain void cash remains unavailable pending independently reconciled money
  effects. A trusted loader must prove disposition authenticity, complete source/
  payout inventory and absence of cross-workflow refunds, including prior months.
  This contract neither performs a void nor introduces database/payout operations.

### CP-005 full ordinary-sale refund cash (October 29, 2026)

- Match the existing bounded refund workflow: full, externally funded service/product
  sales only. Supplied independent settlement records must reconcile payout tenders,
  net/GST/gross totals and complete original line allocations. Do not infer cash
  from reversal bases or extend this to partial refunds, package collection voids,
  redemption-funded sales or unsupported payout methods.
- Each allocation identifies the original sale-line capture and its exact reversal.
  Original source-time staff splits and full net line bases must reconcile; subtract
  those net amounts once, excluding GST. Payout evidence may precede source capture
  within the same requested month because existing writers timestamp them separately;
  original activity must predate payout and reversal cannot predate payout.
- Retain independent settlement/allocation revisions in frozen inputs. Conflicting
  cash/no-cash assertions, reused refund/sale/line/reversal identities and incomplete
  supplied line inventories fail closed. Trusted loading must still prove complete
  funding, inventory, authentic settlement and no duplicate cross-workflow payouts.
  No source workflow, DB schema, payout execution or operational permission changes.

### CP-005 non-cash usage reversals (October 29, 2026)

- REVERSAL is not synonymous with customer payout: source writers also reverse
  redemption, value-spend and session-correction activity. Those bases must not
  automatically subtract from cash. Require independent operational no-cash
  evidence with original operation/event identity, sale/outlet, timestamp, SGD,
  explicit zero net/tax/gross and a frozen operational revision.
- Validate original source lineage and exact negative base/unit evidence before
  accepting zero cash. Missing evidence is unavailable, not assumed zero. Restrict
  this contract to REDEMPTION, VALUE_SPEND and CORRECTION originals; SALE_LINE and
  COLLECTION reversals still require separately reconciled actual money effects.
- This supplied-record contract does not prove operational authenticity, complete
  reversal inventory or absence of a separate payout. Those checks belong to the
  trusted loader. No new payout, source write or DB access is introduced.

### CP-005 refund cash reconciliation (October 29, 2026)

- Package/value-package cash metrics subtract independently evidenced settled net
  payouts in the refund month, excluding GST. Preserve negative staff/outlet totals;
  do not floor denominators to zero or substitute commission earnings for cash.
- Reconcile payout identity, date, tender and net/tax/gross against captured refund
  evidence. Require original collection allocation/sale-line amounts and source-time
  seller shares; refund bases must exactly negate the split refunded net amount.
  One original collection source cannot fund multiple package cancellation events.
- Zero/NONE cancellation needs explicit independent zero-payout evidence. It is not
  inferred from missing payout records. Preserve payout revisions in frozen inputs.
- Supplied records are not proof of settlement, completeness or authenticity. Trusted
  loading must establish those facts. Existing refund services record no provider
  payout; their event alone cannot satisfy this new independent evidence contract.
  Generic reversals remain unavailable until independent cash effects are reconciled.
  No database access or acceptance is authorized by these non-DB changes.

### CP-005 sum-individual population (October 29, 2026)

- Under the delegated policy defaults, SUM_INDIVIDUAL means the sum of eligible
  credited individual activity across the supplied salon/month source inventory,
  including departed staff and staff assigned other plans. It is not limited to
  active logins, plan recipients or caller-provided metric assertion rows.
- The recipient's selected rule determines commission metric types; its historical
  assignment outlets constrain the population. Salon scope sums those eligible
  outlets; outlet scope separately sums each recipient activity outlet, matching
  engine cardinality. Missing required outlet evidence fails closed.
- Fixed/excluded activity still participates; negative earned lines subtract.
  Four-decimal residuals are preserved without applying component rates, base
  percentages, caps or incentive awards. This base metric is not SALON_CASH and
  must never be used as the statement cash denominator.
- Retain rule/version/population line identities with frozen close evidence.
  Deriving totals from supplied records does not establish inventory completeness,
  authoritative selection, correction allocation or release acceptance. The trusted
  transactional loader and CP-005 acceptance remain outstanding; no activation.

### CP-004 isolated acceptance authorization (October 28, 2026)

- Owner explicitly authorized isolated disposable-database CP-004 acceptance only;
  application/production databases remain off-limits. Used fresh loopback 55476
  `/tmp` PostgreSQL cluster, explicit URL and disabled dotenv. No application DB
  repair, activation, deployment, commit or push is authorized. Earlier migration
  incident is not erased by successful disposable acceptance. Stop test cluster
  afterward. This is not blanket permission for future database work.

### CP-004 value-package refund arithmetic (October 28, 2026)

- Multi-collection safety: an aggregate seller refund base cannot represent
  conflicting historical fallback rates. Positive value-package payouts therefore
  require a recorded, numerically consistent rate per original seller across all
  collection sources. Missing/differing rates fail closed before writes; never use
  database result order or current rules to choose one. Equal decimal spellings
  are accepted. Zero-payout cancellation creates no negative bases and does not
  require equal rates. Supporting differing-rate refunds needs a separately defined
  rate-lot allocation policy, not arbitrary first-source selection. This limitation
  is not completion of multi-payment or transactional acceptance.
- Apply CP-D08 to original paid consideration, not promotional face credit. Used
  net value is the cumulative four-decimal VP_SPEND paid-to-credit ratio for credit
  consumed. Subtract that value and the approved net fee from collected net; floor
  at zero and round down only at the customer cent boundary, as for session refunds.
- Refund tax is proportional to original collected tax using half-up cent rounding.
  Original tax/collections must be independently source-validated by the future
  transaction service; the ratio snapshot alone does not prove collection or GST.
- Preserve earned VP_SPEND evidence. Cancel remaining face credit and uncollected
  original debt separately; neither is extra customer cash or a new commission base.
- Pure arithmetic/schema tests are not refund workflow acceptance. API/UI wiring,
  source lineage/collection reconciliation, locking, retry/conflicting retry,
  reversal-after-refund refusal and real rollback/race tests remain outstanding.
  All database work remains paused; no activation or deployment is authorized.

### CP-004 refund and source economics clarification (October 28, 2026)

- SRS section 4 package settings explicitly says fixed dollars **per sale**, versus
  redemption **per session**. Retain one sale award per source sale line, including
  quantity >1, once on its first collection. Quantity remains separate engine units.
  A later instalment never earns the award again, even if prior net was zero.
- Refund clawback uses the original captured fixed award, not current settings;
  prorate by refunded net / original purchase net at four-decimal precision. The
  existing one-refund-per-holding restriction caps total clawback at that award.
- CP-D08's zero floor permits reasoned cancellation of unused sessions with no
  payout. Require explicit `payoutGrossCents: "0"` and `payoutMethod: "NONE"`;
  positive amounts require actual tender. No cash movement/provider call is implied.
  Reconcile ordinals, original collections/sellers and outstanding debt atomically.
  Zero payout writes cancellation evidence, not zero-valued payable/clawback lines.
- OP-2 full list price is the source-time service nonmember catalogue price, captured
  independently of member pricing/discounts. FOC remains full-list-price activity
  beside credit-funded paid lines. Apply plan base/rate once in the engine; preserve
  explicit unavailable evidence rather than retroactively inventing list prices.
- This is local implementation policy, not transactional acceptance or permission
  to access any database. The existing DB pause and release gates remain in force.

### CP-004 prospective package configuration (October 28, 2026)

- Package sale and redemption each require explicit FOLLOW_PLAN, EXCLUDE or FIXED
  selection. Fixed amounts are exact decimal strings; minimum deposit is an explicit
  0–100% exact string. No mode, award or deposit is inferred for existing packages.
- Configuration is restricted to authenticated, enabled salon owners with existing
  two-factor verification, consistent with the payroll owner boundary. Updates
  require the package updatedAt token and a reason; before/after audit is atomic.
- Completed purchases copy settings under the existing package row lock. Later
  changes affect future purchases only. Legacy null holding snapshots remain null.
  Old economics snapshots without settings remain valid but explicitly incomplete.
- Settings capture is not earnings activation, fixed-award posting, deposit
  enforcement or paid-session acceptance. Those integrations remain CP-004 work.

### CP-003 configuration-only acceptance — approved October 28, 2026

- The user approved Option 2: accept configuration separately, provided it works
  safely without a historical monetary preview. This supersedes the earlier
  requirement to complete monetary preview integration within CP-003.
- CP-003 retains configuration persistence, published version immutability,
  assignments, profiles/settings, audit/authorization, sample-input calculator,
  comparison and read-only historical readiness. Missing evidence must return
  `UNAVAILABLE` with `impact: null`, never an estimated zero or legacy repricing.
- Move authoritative historical monetary integration and preview/full-run equality
  to CP-003A, dependent on CP-004 source capture and CP-005 frozen statements/carry.
  Historical monetary preview remains a must-have and a CP-007 release gate.
  Configuration readiness/inventory and sample calculations do not satisfy it.
- CP-003 is IN PROGRESS pending configuration-only acceptance review, not DONE by
  scope approval alone. CP-004 still depends on accepted CP-003 configuration;
  CP-005 depends on CP-004, and CP-003A follows CP-005 without a dependency cycle.
- Configuration must remain non-activating: no payroll earnings, payout changes,
  historical backfill or changes to approved statements. Production migration,
  activation and deployment require separate authorization. Do not start CP-004
  as part of this scope-revision task.

### CP-003 historical-preview evidence boundary (October 27, 2026)

- Last closed month means the last completed calendar month in the persisted salon
  timezone, not an assertion that a payroll statement is approved/frozen.
- Read-only readiness may resolve effective assignment/version configuration, with
  pre-close staff/salon audit evidence. Missing historical settings stay unavailable;
  never substitute current join dates, current catalogue values or assumed defaults.
- Existing collection candidates and rate-bearing legacy earnings do not establish
  complete rate-free bases, outlet/category/fixed-award evidence, frozen carry or
  authoritative group metrics. Return explicit UNAVAILABLE/null impact until those
  inputs can be proven. Counts are inventory only; no partial payout estimate.
- This boundary does not accept TC-25, enable earnings or start CP-004. Under the
  October 28 scope revision, monetary integration/full-run equality belong to
  CP-003A rather than CP-003 configuration acceptance.

| ID         | Adopted decision                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1        | Package-sale base is actual collected net consideration, excluding GST, on each collection date; refunds are negative bases.                                                                                                                        |
| D-2        | Staff are assigned versioned plans with monthly tiers and tenure stages.                                                                                                                                                                            |
| D-3        | Redemption uses original purchase session economics, never current catalogue prices.                                                                                                                                                                |
| D-4 / OP-1 | Methods are component settings. Seed On course as whole-tier; allow effective-dated changes with impact preview.                                                                                                                                    |
| D-5        | Calendar-month assignment and published version effective on the last local day apply to the whole month.                                                                                                                                           |
| D-6        | No-plan staff use existing flat-rule precedence; no double payment alongside plan results.                                                                                                                                                          |
| D-7        | Refund negative sale base goes to original sellers; legitimately earned redemption commission remains. Voiding a session is a distinct reversal.                                                                                                    |
| D-8        | Only paid-for sessions may be redeemed; extra sessions require verified manager PIN authorization and audit reason. Never trust a client-supplied manager ID.                                                                                       |
| OP-2       | FOC base is full snapshotted list price; apply 50% base and 5% rate once in the Hair plan. A list price of 492 gives 12.30, not 24.60.                                                                                                              |
| OP-3       | Hair top band remains 25% above 25,000, without cap by default.                                                                                                                                                                                     |
| OP-4       | New-staff Hair stage is months 1–3; TP has one standard stage, not the Hair override.                                                                                                                                                               |
| OP-5       | Seed individual incentive metric is SVC + PKG_SALE + PRD; exclude redemption.                                                                                                                                                                       |
| OP-6       | Default group metric is salon-wide actual net cash collected within one tenant. Outlet scope remains configurable as required by FR-INC-04. This deliberately differs from the SRS proposed outlet default and follows the approved recommendation. |
| OP-7       | Seed VP_SALE with package sales and VP_SPEND with On course. Preserve paid-to-credit ratio snapshots through spends/transfers.                                                                                                                      |
| OP-8       | Join month counts as month 1 even after the 15th; delayed-month setting is off by default and remains configurable.                                                                                                                                 |
| OP-9       | Configurable defaults: minimum deposit 30%; refund administration fee SGD 100. Changes must not rewrite purchase evidence.                                                                                                                          |

## Integration decisions

| ID     | Adopted decision / acceptance consequence                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-D01 | New plans are authoritative after controlled prospective activation. Existing transaction-rate evidence remains historical/fallback evidence, not an additional payable result.                                                                                                                                                                                                                                                                   |
| CP-D02 | New base capture uses existing receipts, payments, users, holdings, transfer and valuation records. Do not deploy the demo's independently mutable staff/holding mirrors.                                                                                                                                                                                                                                                                         |
| CP-D03 | Existing exact-cent allocation is authoritative for operational purchase value. Store separate four-decimal commission unit snapshots where required. Paid-session checks compare exact values without epsilon; reconcile final-session/split residuals. A multi-service set consumes one defined package unit, not one unit per service line.                                                                                                    |
| CP-D04 | Cash means settled external monetary consideration, not notes-only. Card/electronic payments qualify. Package sessions, prepaid credit and gift-card redemption do not create fresh cash collection. Mixed receipts and GST require explicit source allocation. Unsupported/unsettled tender evidence is rejected, not guessed.                                                                                                                   |
| CP-D05 | Approved periods and complete payroll statements are immutable. Freeze base selection, plan/stage, profiles, adjustments, collection denominator, calculation version, carry-forward and totals. Record an input revision/hash and reject stale calculation approval.                                                                                                                                                                             |
| CP-D06 | Approval locks a statement; it does not assert money has been paid. Record payout confirmation separately with actor/time/reference; no bank integration is implied.                                                                                                                                                                                                                                                                              |
| CP-D07 | Include departed/disabled staff with period activity, carry-forward or amounts owed. Disable future attribution without erasing historical statements.                                                                                                                                                                                                                                                                                            |
| CP-D08 | Refund = max(0, collected net consideration minus used-session net value minus configured fee), subject to the approved package policy. Preserve original GST/tender accounting separately; never substitute a commission formula for the customer cash/GST refund ledger. Fixed sale awards are paid once; refunds proportionally claw back their original award against refunded net purchase consideration, cumulatively capped at that award. |
| CP-D09 | Negative bases carry to the same stable component key by default; write-off is configurable and audited. Component removal/plan switches require an explicit mapped carry balance or audited write-off, never silent loss.                                                                                                                                                                                                                        |
| CP-D10 | No automatic legacy-value invention or retrospective payroll rewrite. Cutover inventory must classify reliable, incomplete and already-paid evidence. Historical dates are not a go-live commitment.                                                                                                                                                                                                                                              |
| CP-D11 | Reuse current flat-rule hierarchy for no-plan staff, including staff/item/department/company behavior. Resolve fallback rate at source time and preserve evidence. Package fixed/excluded handling still applies without a plan.                                                                                                                                                                                                                  |
| CP-D12 | Payroll export/approval and salary-profile changes are salon SUPER_ADMIN-only; managers calculate and adjust with reasons. Follow SRS permission table rather than looser demo routes. Staff self-service is own-data-only.                                                                                                                                                                                                                       |
| CP-D13 | Implement real Excel summary + per-staff sheets and payslip PDF. CSV may be additional, not a substitute. Choose libraries only after checking existing dependencies and requirements.                                                                                                                                                                                                                                                            |
| CP-D14 | Ship specified manual payroll components only, not statutory payroll. No CPF, IR8A, GIRO, automatic leave calculation or legal-compliance claim.                                                                                                                                                                                                                                                                                                  |
| CP-D15 | Monthly boundaries are local start inclusive / next month start exclusive, avoiding end-of-day precision loss. Default SGD and Asia/Singapore; no mixed-currency totals.                                                                                                                                                                                                                                                                          |

## Known source discrepancies resolved

### CP-004 purchase session precision (October 28, 2026)

- New holdings capture original contracted net consideration, stored GST, original
  session grant, sellers and source IDs at completion, independently of activation
  of the operational exact-cent package-value ledger. Contract value is not cash
  collected; subsequent collections never rewrite the purchase snapshot.
- Commission session values allocate original net value in 0.0001 units. Store the
  per-session floor plus number of initial ordinals receiving one extra tick.
  Original ordinal ranges reconcile exactly to purchase net and split deterministically.
  Do not substitute operational cent-rounded values or current catalogue prices.
- These are economics-only facts, not complete payroll inputs: absent package
  commission settings, confirmed currency or sellers remain explicitly missing.
  No assumed FOLLOW_PLAN mode, paid-session approval, fallback, fixed award or
  earnings activation. Legacy holding snapshots stay null; ownership changes retain
  original purchaser/source/seller evidence.

### CP-003 outlet assignment and pooling contract (October 27, 2026)

- Retain one effective-dated plan timeline per staff member, selected on the last
  day of the payroll month. Plan outlet scope is eligibility, not a second independent
  staff assignment timeline. An empty outlet list means all outlets in the tenant;
  selected outlets pool together once for component tiers and monthly caps.
- New assignment events snapshot the plan's outlet IDs server-side. Legacy
  assignments without outlet IDs are company-wide: only company-wide plans were
  assignable before this change. Clients cannot submit assignment scope. Plan scope
  remains immutable metadata; duplicate a plan to change it. Existing closed rows
  and their scope are retained when replacing an assignment.
- Company-context owners may assign published scoped plans, including during atomic
  classified creation. All selected outlets must currently be active in the tenant.
  Outlet sessions still cannot mutate/read company-wide staff timelines or salary
  profiles. No assumption is made that department links identify outlets.
- Out-of-scope activity uses the existing source-time flat-rule fallback, not the
  scoped plan's tiers. Shared partitioning returns disjoint plan/fallback inputs
  without dropping activity; scoped calculation rejects unpartitioned out-of-scope
  lines. Missing active-line outlet evidence fails closed for a scoped plan.
- This continuation delivers assignment snapshots, selection UI and the pure
  pooling boundary contract. Combining plan/fallback results, keeping incentive
  metrics and carry balances correctly scoped, and frozen statement reconciliation
  remain CP-005 integration work. No new earnings path is enabled or paid twice.
  Authoritative historical preview and authenticated browser acceptance remain open.

### CP-003 mandatory classified creation (October 27, 2026)

- Every staff create request requires an explicit reasoned payroll classification
  and authoritative join date. Commission earners also require an initial published
  plan with current-month and ongoing coverage. The shared runtime schema and direct
  service entry point reject identity-only creation; the transactional helper also
  rejects absent classification. Identity, branch links and payroll audit save together.
- Classification remains owner-only. Staff POST is therefore salon SUPER_ADMIN-only,
  with existing owner verification and writable-tenant checks in the transaction.
  Managers retain profile-edit/suspension permissions but cannot create an
  unclassified identity or assign themselves classification-write privileges.
  The UI hides manager creation and explains that owner setup is required.
- This deliberately supersedes the earlier identity-only creation compatibility
  exception and manager POST behavior. No role, title or legacy rate implies a
  classification. Existing unclassified records are not automatically rewritten.
- Company-only initial plan restrictions remain until outlet pooling is implemented.
  This closes the staff endpoint's mandatory creation gap, not full FR-ASN or CP-003
  acceptance. Platform provisioning and unrelated authentication flows are unchanged.

### CP-003 unclassified active-edit enforcement (October 27, 2026)

- Active staff PATCH now fails closed when the latest audited commission
  classification is absent or unrecognized. Login role, position and legacy rate
  cannot substitute for owner-reviewed payroll setup. The error directs callers
  to the existing owner-only, reasoned payroll settings workflow.
- Suspension and maintenance while disabled remain possible. Reactivation requires
  an explicit supported classification, authoritative join date and, for commission
  earners, the existing current-month and ongoing plan coverage checks. Validate
  under the tenant configuration lock before identity or department-link writes.
- This supersedes the earlier unclassified **edit** compatibility exception only.
  Identity-only creation remains an open lifecycle gap; no automatic classification,
  historical rewrite, earnings activation or full FR-ASN-01 acceptance is claimed.
- HTTP fixtures explicitly record synthetic classification rather than infer it
  from roles. Immutable test audit is retained with uniquely named test tenants;
  cleanup does not disable triggers or delete configuration evidence.

### CP-003 classified staff edit/reactivation guard (October 27, 2026)

- General staff PATCH validates the latest audited payroll classification while
  holding the same tenant configuration lock as payroll writes. Active classified
  staff require an authoritative join date; commission earners also require
  current-month-end and open-ended plan coverage using the payroll validator.
- Reject inconsistent active edits before updating identity or department links.
  The caller cannot evade these guards through login-role, title or department
  changes, or by omitting date fields from PATCH.
- Disabling an account must remain available even when its payroll configuration
  is inconsistent. Disabled profiles may be maintained; reactivation requires
  valid classified configuration. Owner-only audited payroll repair/reclassification
  remains the recovery path; managers do not gain classification-write privileges.
- Legacy unclassified records still need explicit lifecycle/cutover work. This
  guard does not classify them automatically, activate earnings or establish full
  FR-ASN-01 acceptance.

### CP-003 atomic classified staff creation (October 27, 2026)

- Staff creation may supply a reasoned `payrollClassification`. It requires an
  authoritative join date; commission-earning classification also requires an
  initial assignment. Identity, department links, assignment and classification
  audit commit together using the existing owner-verified configuration lock.
- Reuse payroll settings validation inside that transaction, not a second service
  transaction after identity creation. A future-only plan fails current-month
  coverage and rolls back the whole creation. Non-commission classification may
  be created without a plan, but still requires join date, reason and owner access.
- This is the classified creation path, not a silent compatibility cutover.
  Identity-only creation remains unclassified, manager permissions are not expanded,
  and mandatory create/edit lifecycle enforcement is still open. Do not claim
  FR-ASN-01 accepted until those paths are integrated and verified.

### CP-003 explicit commission classification (October 27, 2026)

- Payroll commission classification is independent of `globalRole` (login
  permissions), free-text position and legacy flat commission rate. Do not infer
  eligibility from any of those fields. Owner-only reasoned STAFF configuration
  events hold `COMMISSION_EARNING` or `NON_COMMISSION` without a mirrored user row.
- Existing events without classification read as null: **Not classified — review
  required**, not an automatic exemption. Omitted classification preserves the
  previous audited value; explicit null/empty/unknown classifications are rejected.
- Marking staff commission earning requires their authoritative join date, an
  assignment covering the last day of the current salon-local payroll month and
  an open-ended assignment (no scheduled removal). Assignment removal is blocked
  while classified commission earning. Explicitly reclassify with a reason first.
- All comparisons and writes share the tenant configuration lock and revision
  checks. This policy applies to configuration only; it does not activate earnings,
  reprice historical activity or make classification an authentication permission.
- Mandatory create/edit classification and plan/join-date lifecycle enforcement
  remain open. This incremental workflow is not FR-ASN-01 acceptance. Future work
  must resolve legacy unclassified staff deliberately, not silently exempt them.

### CP-003 assignment/join-date consistency (October 27, 2026)

- An initial or replacement plan assignment cannot start before the authoritative
  staff join date. An audited join-date edit cannot move that date after any
  existing assignment start, including closed historical assignments.
- Validate both directions under the tenant configuration lock, before writing
  assignment history or staff settings audit. Rejected changes leave dates,
  timelines and audit revisions unchanged. This does not classify commission roles
  or satisfy mandatory plan/join-date enforcement for every staff lifecycle path.

### CP-003 atomic initial assignment (October 27, 2026)

- Add an optional `payrollAssignment` to staff creation: non-null plan, prospective
  assignment date, captured company assignment revision and audit reason. A join
  date is required when supplied. Identity, department links and assignment audit
  use one transaction under the existing tenant configuration lock; hashes are
  computed before locking. Reuse existing owner verification, company-only plan,
  publication, writable-tenant and locked-period checks. No earnings activation.
- Keep identity-only creation compatible. This incremental workflow is **not**
  acceptance of FR-ASN-01: mandatory join dates/commission-role plan enforcement
  and existing-staff lifecycle coverage remain open. No commission-earning role
  classification is inferred from authentication roles, departments or a flat rate.
- The owner UI explicitly opts into atomic assignment and retains failed form
  input. Assignment revisions refresh only by explicit reload/reselection, never
  by silently retrying a conflicting write. The existing post-create continuation
  remains available for additional settings and is separate from atomic creation.

### CP-003 employment-date concurrency (October 27, 2026)

- `User.startDate` remains the single authoritative join date. Payroll settings
  writes require both the captured payroll-event revision and `expectedJoinDate`
  (date or null); staff date writes require `expectedStartDate`. Compare while
  holding the same tenant configuration lock, not in a separate preflight read.
- A staff member with payroll settings or assignment history changes join date
  only through the owner-only reasoned payroll workflow. General staff PATCH may
  still update unrelated profile fields or repeat an unchanged date with a matching
  expectation. Missing comparisons fail closed; stale comparisons return conflict.
  This intentionally tightens date-write API compatibility; clients must reload
  and supply the captured date, never substitute the proposed date as expectation.
- This is configuration safety, not acceptance of immutable approved statements,
  required-plan staff creation, outlet assignment policy or historical preview.

### CP-002 arithmetic and fallback contract (October 27, 2026)

- Use dependency-free bigint rational arithmetic in the existing shared package;
  no floating-point monetary calculations. Pool/apply base percentage at four
  decimals and round component results half-up to two decimals.
- Fractional fixed-component units are already staff-split. Four-decimal allocation
  residuals use stable staff-ID order; negative splits exactly reverse positives.
  Value-package spend bases use differences of cumulative rounded ratio values.
- Exclusive tier gaps advance by 0.0001, not the reference engine's cent increment.
  Missing join dates fail closed for staged plans rather than inventing tenure.
- No-plan fallback consumes existing source-time resolved hierarchy rates. Its
  negative balance retains exact commission debt at ten decimals, not an unpriced
  base that could be repriced after a rate change. A switch to a plan with such debt
  fails until separately settled explicitly; CP-005 must preserve/audit settlement.
- Package fixed/excluded activity remains eligible for configured incentive metrics,
  while bypassing plan earnings. Fixed negative award lines are explicit clawbacks;
  fixed-unit component negative units carry to the next period by default.
- Group collection metrics are explicit same-period, metric-kind/scope inputs from
  the authoritative service, never inferred by summing commission bases.

- SRS historical Stella sample uses sales value: commission 1,971.62 + incentive 50.
  Under new collected-package base 8,688, commission is 1,931.84 and incentive 0.
  Keep both fixture scenarios separately labeled; do not force new policy to match
  old-sheet totals by reverting to sales value.
- Historical Alvin 1,199.99 assumes 492 is already the FOC half-base. Recommended
  fixture with 492 full list price totals 1,187.69. Do not halve twice.
- SRS contains GC_SALE, outlet scope, Excel/PDF and richer audit/report requirements
  absent or incomplete in reference code. Docs win; requirement gaps stay TODO.
- Reference approval marks bases PAID, uses active-only staff, and dynamically reads
  salary/collection for statements. Replace those behaviors per CP-D05–CP-D07.
- Reference generic fallback omits current hierarchical rules and package fixed
  handling. Port behavior deliberately, not the fallback function unchanged.
- Reference service writes are not a complete transaction/retry/tenant-security
  design. Existing production architecture wins on safety, not old commission policy.

No owner-policy question is currently blocking. Newly discovered safety-critical
or scope-changing conflicts must be documented, not treated as blanket permission
to modify production, erase history or expand statutory payroll scope.
