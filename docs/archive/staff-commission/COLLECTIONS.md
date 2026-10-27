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

### Later-payment API — October 27, 2026

`GET /api/sales/:id/collections` exposes current outstanding cents, nullable confirmed
currency, contracted and explicitly allocated gross cents by line, and captured
later-payment history. Unknown earlier payments are never redistributed. Historical
or unsupported sales remain readable with canCollect=false.

`POST /api/sales/:id/collections` records one cashier-confirmed money receipt. The
strict body requires idempotencyKey (UUID), currency=SGD, collected=true, grossCents
(positive integer string), reason, and allocations[{saleLineId,grossCents}]. Each
line appears once and allocations sum exactly to the receipt. No gateway operation,
credit redemption, client timestamp or client actor is accepted. This is recorded
money evidence, not independent settlement verification or payment acquisition.

Both routes require sales-module authentication and honor selected outlet/tenant
scope. Writes require a writable tenant; actor authorization comes from the request
scope and capture verifies an enabled salon member. A sale must be completed,
unrefunded, owned by a customer and already have matching confirmed currency. No
historical currency backfill is allowed. The receipt cannot exceed current debt.

The tenant prepaid lock precedes sale/configuration locks. Outstanding-payment
source, original seller/event-time rate evidence and debt decrement commit atomically.
Canonical retry comparison includes actor, sale, reason and allocations. Retries do
not reduce debt twice; concurrent competing receipts cannot overcollect. Invalid
line allocation returns HTTP 400 and rolls back all writes; conflicting retries or
insufficient balance return 409; malformed contracts return 422.

Original Sale.paidAmount/paymentStatus, checkout tenders, receipt outstandingAmount,
points and contracted package value remain historical snapshots. Current debt and
later-payment history must be read from the new endpoint, not those receipt fields.
No earnings are posted. Later-payment UI, collection reconciliation/reporting and
source reversal workflows remain unfinished. No migration was needed.

Verified 145/145 focused API/database/HTTP/POS tests (no skips), shared 201/201,
workspace typecheck/lint. Acceptance uses only disposable PostgreSQL port 55476.

### Remaining integration work (updated)

1. Persist immutable original collection sources and per-line allocations, with
   tenant/sale/currency validation, source identity, event-time own-rate snapshots,
   original sellers/splits, database immutability and retry/hash protection. Known
   collections must not be inferred for pre-existing sales lacking this evidence.
   Internal persistence and recorded-money POS/later-payment API callers are implemented
   above; independent settlement proof remains outside this recorded-money checkpoint.
2. Extend shared POS request/response contracts and payment UI to submit confirmed
   allocations. Reconcile actual settled cash separately from overpayment/change,
   redemption tenders and credit granted. Hold/unsettled payments earn nothing.
3. Complete authenticated browser acceptance for the later-receivable API/UI now
   implemented. Outstanding balances remain separate from contracted package value.
   Original sellers survive later receipts while rates resolve at collection time.
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

The calculation/capture helper stays internal; the later-payment service now provides
the authenticated public collection endpoint described above.
SC-005 remains responsible for the reconciled report/writer activation boundary.
Normal POS now supports opt-in explicit collection evidence only. Legacy commission
reporting and earnings activation remain unchanged. Refund/void allocation evidence
is not integrated yet; do not use captured gross/net as current paid-session coverage
without implementing source-linked reversal and eligibility checks first.

### Later-payment UI — October 27, 2026

SaleCollectionsPanel is rendered beside both new and reopened historical receipts.
It reads current outstandingCents from GET collections and never rewrites the original
checkout paidAmount/paymentStatus/outstandingAmount/tenders. It shows contracted line
values, explicit allocated values and later-payment history. Historical unknown SGD
currency remains unknown; collection availability follows server canCollect.

Recording requires an explicit amount and matching named line allocations, collected
SGD confirmation and reason. Decimal input is parsed with integer arithmetic without
rounding. Confirmation resets after input edits or a changed server balance snapshot.
No default/pro-rata allocations, payment inference, gateway calls or earnings posting.
Read-only tenants and reversed receipts cannot record; API permissions remain authoritative.

The complete UUID request is saved in session storage before submission, scoped to
tenant, actor, outlet and sale. Uncertain failures freeze the submitted request; retry
reuses it exactly after reopening/reloading, even if the server now reports zero debt.
This is reconciliation of the existing attempt, not permission for new capture when
canCollect is false. Definite validation/permission/conflict refusals refresh state and
retain editable fields with confirmation cleared. Storage unavailability refuses a
new submission. No automatic POST retries. Successful writes refresh current collection
state and invalidate customer/report/dashboard views without changing receipt snapshots.

Verified web 852/852, including 20 panel tests and receipt-page integration; shared
201/201, workspace typecheck/lint and web production build. Authenticated browser
acceptance and API/database regressions were not rerun for this web-only checkpoint.
No migrations, deployment or earnings activation. SC-006 remains IN PROGRESS.
