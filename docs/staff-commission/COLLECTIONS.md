# SC-006 — Collection implementation checkpoint

October 27, 2026. **IN PROGRESS**, not a release or financial activation.

## Implemented and verified locally

`../../apps/api/src/lib/commission-collection.ts` provides pure integer calculations:

- Explicit receipt-to-line allocation validation. Reject missing/duplicate lines,
  nonpositive amounts, overcollection and unreconciled receipt totals. No automatic
  pro rata suggestion, silent remainder, persistence or tenant authorization.
- Cumulative collection gross-to-stored-tax/net deltas. Full collection equals the
  original discounted consideration exactly. Contracted valuation is never mutated.
- Source-lot cumulative refund components and ten-decimal earning-unit clawbacks,
  with the final refund consuming the exact residual. The caller supplies the
  original earning and lot; these helpers do not find or authorize source records.
- Exact original-session prefix coverage, using the existing valuation allocation
  and binary search rather than rounded averages or expanded per-session rows.
  UNKNOWN legacy evidence is distinct from COVERED and INSUFFICIENT. No permission,
  expiry, availability, manager override or commission authorization is implied.
- Original paid-to-credit ratio deltas including bonus credit and exact cumulative
  restoration. Original consumed deltas must still be persisted for out-of-order
  restores; do not recompute a historical debit using today's aggregate spend.
- Service funding partition: ordinary service basis excludes credit-funded net.
  Credit-funded net is not itself the spend earning basis; that uses source-lot ratio.

Ten calculation tests plus nine existing valuation and four commission precision
tests pass (23/23, no skips). API typecheck and lint pass. No database changes.

## Required continuation before DONE

### Internal persistence checkpoint

Added `../../apps/api/src/services/commission-collection-evidence.ts` and migration
`20261027120000_commission_collections`. CommissionCollection stores source identity,
receipt amount/time, currency, authenticated actor and retry hash. Its append-only
allocations store original line values, sellers/splits and event-time package-sale
or stored-credit-sale rate candidates. These remain PENDING_RELEASE, not earnings.
The capture function acquires prepaid/POS then configuration locks and must be used
in the transaction containing the authorized money operation. A caller already holding
configuration/holding locks must not enter it without first holding the prepaid lock.

Source guards support recorded non-credit SalePayment without a gateway session and
CustomerOutstandingPayment linked to the same sale/customer/outstanding. Gateway
session presence fails closed; callbacks and provider settlement identity are not
implemented. Overpayment/change must be separated before capture: a whole source
receipt must reconcile and cannot exceed contracted line values. There is no automatic
historical caller, currency inference, on-account remainder or existing-sale backfill.

Currency must come from trustworthy sale/settlement evidence supplied by the future
caller; these old source tables have no currency field. The helper only validates its
format and consistency with prior explicit collections. The current seam therefore
must not be exposed as an endpoint accepting arbitrary client currency. No later-payment
application workflow or POS request/UI has been delivered by this persistence layer.

Database guards reject source/actor/tenant mismatches, mutable evidence, incorrect tax
deltas, overcollection and incomplete per-source allocation at commit. Unique source
identity is separate from retry identity. Current capture does not permit reusing a
source with a different key; conflicting requests fail rather than double-count.
Original seller identity persists even when the seller is later disabled. A disabled
current actor cannot capture or retry. No cashier attribution fallback is used.

Verified 34/34 focused calculation/resolver/tenancy/database tests, no skips; API
lint/typecheck/build and shared build pass. All 56 migrations replayed from empty on
disposable PostgreSQL at port 55476, database commission_collection_replay. Acceptance
is opt-in via COMMISSION_COLLECTION_ACCEPTANCE=1 and restricts database host/port/name.
Initial fixture actor-field and deferred-trigger errors were corrected before the
successful fresh replay. No application migration, earnings activation, HTTP/browser
acceptance or complete SC-006 claim. The application has no normal caller yet.

### Remaining integration work

### Opt-in checkout capture — October 27, 2026

The new-sale and held-completion paths now accept an optional strict `collection`
object with confirmed SGD currency and explicit paymentIndex/linePosition/grossCents
allocations. PaymentDialog displays named cart lines and requires exact per-tender
amounts plus cashier confirmation. No pro rata inference is performed. Every amount
is validated against server-priced lines in the same POS transaction; invalid input
rolls back the sale, receipt number, tenders, debt and allocation records.

Sale.collectionCurrency is nullable; null retains unknown legacy evidence. Migration
20261027130000_sale_collection_currency allows confirmation at creation or held-cart
completion only, and protects it thereafter. The receipt API exposes confirmation.
The UI follows the existing SGD-only POS/receipt currency; it neither adopts SaaS
subscription currency nor infers historical purchase currency. The internal capture
seam additionally rejects a currency conflicting with confirmed sale currency.

This is recorded-money evidence explicitly confirmed by the cashier, not provider
settlement verification. Supported capture: positive recorded non-redemption tenders,
including deposits and split tenders, with no change or gateway session. Zero tenders
carry no allocations. Unsupported capture fails rather than guessing funding. The
ordinary checkout path without collection evidence remains compatible, so this is
not the final mandatory release gate. Old unknown sales remain unknown.

Verified focused API/database/POS regressions 91/91, no skips; shared 199/199; full web
831/831; workspace production build/typechecks and lint pass. The new migration was
applied only to disposable commission_collection_replay on port 55476; 57 migrations
total, not a new full replay claim. No authenticated browser or HTTP walkthrough.

Remaining work below is still required; checkout captures candidates, not earnings.

1. Persist immutable original collection sources and per-line allocations, with
   tenant/sale/currency validation, source identity, event-time own-rate snapshots,
   original sellers/splits, database immutability and retry/hash protection. Known
   collections must not be inferred for pre-existing sales lacking this evidence.
   Internal persistence is implemented above; settlement/currency proof and POS callers
   remain outstanding, including preserving attribution against later source changes.
2. Extend shared POS request/response contracts and payment UI to submit confirmed
   allocations. Reconcile actual settled cash separately from overpayment/change,
   redemption tenders and credit granted. Hold/unsettled payments earn nothing.
3. Add the currently missing later-receivable collection workflow and preserve
   outstanding balances separately from contracted package value. Original sellers
   survive later receipts while rates resolve at collection time.
4. Integrate source-linked full-refund/void allocations and exact earning reversals
   in the existing cash contract. Unrefunded eligibility net comes from surviving
   lot components; do not independently reround remaining sale-wide gross. Persist
   cumulative refund identities and original per-staff source amounts. Completed
   valid session earnings survive ordinary purchase refunds.
5. Persist credit-lot ratios, deterministic lot draws and per-lot debit/restoration
   evidence; enforce collection coverage before credit use. Do not invoke both
   ordinary-service and credit-spend writers for the same funding slice.
6. Integrate paid-session eligibility before redemption, preserving original ordinal
   availability/restoration. Add visible UNKNOWN legacy status and a reasoned,
   current-manager-authorized immutable override recording actor/time/ordinals and
   observed coverage. Never interpret UNKNOWN as paid or silently block legacy use.
7. Verify POS → commission configuration → stable holding/source lock ordering and
   atomic balance/evidence/earning/audit writes. Add isolated PostgreSQL/HTTP tests
   for retry conflicts, races, permissions, tenancy, rollback, multiple packages,
   split staff/rate changes, tax/discounts, refunds, transfers, mixed tender, bonus
   credit and valuation regressions. Run applicable shared/web and workspace checks.

The helper API is an internal calculation seam, not a public collection endpoint.
SC-005 remains responsible for the reconciled report/writer activation boundary.
Normal POS now supports opt-in explicit collection evidence only. Legacy commission
reporting and earnings activation remain unchanged. Refund/void allocation evidence
is not integrated yet; do not use captured gross/net as current paid-session coverage
without implementing source-linked reversal and eligibility checks first.
