# SC-002 — Foundation and integration contract

October 26, 2026. Implementation contract derived from the approved policies and
local code, not approval to deploy, backfill, or enable new earnings. SC-003/004/006/005
must integrate and verify their own workflows before release.

## Existing behavior and rollout boundary

`sale.service.ts` currently pays only attributed SERVICE/PRODUCT lines on discounted
net contracted value, rounded per line. `reverseForVoid` deletes unpaid rows and flags
paid rows; full-sale refund mutates unpaid rows or creates paid adjustments.
`report.service.ts` groups these rows by sale date/creation date. These are legacy
semantics, not the new collection policy. SalePayment and CustomerOutstandingPayment
have no immutable line allocation; SaleRefund is currently one full-sale refund.
Partial refund rights and provider payment behavior are not expanded here.

Extend EmployeeCommission, not a second monetary ledger. Null ledgerVersion means
legacy evidence, **not** zero earnings or confirmed attribution. Version 1 stores
immutable earning/adjustment/reversal rows with source, actor, period, currency,
rate, credited staff, basis, share and original snapshot. Existing reports and
legacy void/refund writers explicitly select null-version rows. No new posting
primitive is called by POS yet. SC-005 must replace this compatibility filter with
a reconciled staff/type/period report before activation; never add the same source
as both a legacy row and a version-1 row. A tenant activation boundary and writer
switch are required in integration, not an inferred migration date.

## Rates, precision and source identity

Kinds: SERVICE, PRODUCT, PACKAGE_SALE, PACKAGE_REDEMPTION, FOC,
STORED_CREDIT_SALE, STORED_CREDIT_SPEND. Existing public settings only accept
SERVICE/PRODUCT until SC-004 validates each catalogue and permission path.
Resolver order: staff ITEM, company PACKAGE (package kinds only), staff DEPARTMENT,
STAFF, COMPANY, NONE. Latest effective event wins per scope; null inherits, explicit
zero stops. Existing SERVICE legacy fallback remains before COMPANY unless a STAFF
event explicitly opts into inheritance. No legacy fallback for new kinds.

Snapshots use exact two-decimal net basis and percentage, integer share basis points
(1–10000). Attribution integration validates 1–4 distinct enabled staff totaling
10000; each gets its own resolved rate at the source event's effective time. Later
instalments retain purchase seller/share identity but resolve the rate effective at
collection time; store both the collection timestamp and rule evidence. Corrections
must explicitly reference the original attribution rather than changing it.

Amount = basis × rate / 100 × share / 10000. A one-cent basis, 0.01% rate and
0.01% share produces 0.0000000001 currency units. Four decimals cannot represent
this. DECIMAL(24,10) is exact for these bounded inputs, with fourteen integer digits;
no floating-point monetary calculations. Aggregate exact values per tenant, staff,
kind, currency and period, then round half-up to cents once (negative ties away
from zero). Distinct staff/type subtotals can have a disclosed rounding residual
against rounding a company-wide raw total; sum displayed subtotals for exports.
Refund proration must use cumulative allocated refunded cents and differences of
cumulative entitlement, not repeatedly rounded percentages; final reversal consumes
the exact remaining source amount. Never increase storage precision silently for
a future rate/split format: revise the contract and proof first.

Source event keys are deterministic per operation, credited staff and correction
revision, at most 128 characters. SHA-256 of parsed evidence detects conflicting
retries. Repeated identical evidence returns the existing row even after period lock.
Tenant publisher lock serializes rate/period/posting operations; unique event and
reversal keys provide a second database guard. The caller supplies the existing
sale/payment/redemption transaction; downstream failures roll back earnings too.
Database triggers reject evidence update/delete, malformed amounts, cross-tenant
references, non-exact reversals and closed-period postings. Paid status must later
be a separate audited payment record: immutable earnings cannot update paidAt.

## Explicit collection allocation — SC-006 contract

1. Add immutable collection-source records distinguishing original SalePayment,
   CustomerOutstandingPayment and any settled gateway callback. Deduplicate gateway
   identity independently of user retries. Store currency, actual settled amount,
   actor, effective timestamp and original sale; credit granted is not collection.
2. Require explicit amounts per sale line for mixed sales, multiple packages and
   subsequent receipts. No automatic sale-wide pro rata package cash inference.
   UI may suggest values but must submit and confirm them. Under/over-allocation,
   foreign sale/tenant/currency and exceeding each line's remaining gross fail
   atomically. All allocatable receipts must reconcile to line gross allocations;
   any supported on-account remainder is separately named and earns nothing.
3. Each line retains discounted contracted net N, stored tax T, gross G=N+T.
   At cumulative allocated gross C, tax component is half-up(C×T/G) cents,
   net=C−tax, capped at N/T and exact at full collection. Store signed delta
   components from the previous cumulative state. For G=0, both components are
   zero; reject positive collection allocation. Net plus tax always equals gross.
   This is a collection attribution calculation, never a rewrite of stored GST.
4. Collection commission uses only the new net delta, original seller/share evidence
   and event-time rate snapshots. Mixed tender allocations retain each source lot;
   package credit grant, held cart and unsettled card authorization earn nothing.
5. Refund/chargeback allocations reference original collection/line lots and cannot
   exceed unrefunded allocations. Preserve original earning rates and staff. Reverse
   commission cumulatively against the source earning, with final exact residual;
   ordinary refund keeps valid completed-redemption commission. Source void reverses
   the exact event once. Existing full-sale refund payouts remain the cash contract;
   allocation is evidence, not authority to introduce partial refunds.
6. Lock order: existing tenant POS lock, commission publisher/tenant lock, holding
   locks in stable order, then collection/ordinal rows. Verify against actual caller
   lock order before wiring SC-003/006; never acquire the POS lock after tenant lock.
   All reads, balance changes, allocations, earnings and audit commit together.

## Session eligibility, zero and legacy evidence

Keep immutable package purchase net/tax/gross and exact ordinal session ranges from
the valuation ledger unchanged. Collection eligibility uses cumulative unrefunded
allocated purchase **net**, not rounded average session price or current catalogue
price. Determine the prefix whose cumulative original net ordinal values are fully
covered; consumed ordinals remain consumed. A whole service set is one indivisible
ordinal. Restoration returns the exact ordinal, not a fresh average or added credit.
Before redemption, require all selected ordinals covered or a reasoned manager
override recording selected ordinals, coverage, actor and timestamp. After refunds,
valid completed sessions retain commission; further redemptions recheck remaining
coverage, and overrides do not manufacture collection or contracted value.

Fully zero-valued, **evidenced** purchases have zero commission and no money-based
coverage restriction, but retain ordinary session count/expiry rules. Free ordinals
within a positive-value package follow the same prefix ordering. Unknown legacy
purchase value, payments or sellers are explicitly UNKNOWN: retain existing legacy
redemption behavior with a visible unverified-evidence flag and no invented new
commission. Do not silently block historical use or mark it paid. Audited manager
evidence/override is required to opt into new eligibility; no synthetic backfill.
Transfers/family sharing retain original source purchase and seller; performer is
the new redemption's attribution. Expiry earns no unused-session commission.

## Stored credit and FOC

Each purchased credit lot needs immutable paid net, stored tax, granted credit
(including bonus), currency and collection allocations. Spend consumes source lots
in deterministic purchase-time/id order; retain exact per-lot debit evidence. For
original net paid P and granted credit Q, cumulative credit spent S maps to
half-up(S×P/Q) net cents; use cumulative differences and exact final remainder.
Q=0 refuses spend; P=0 yields zero spend basis, not an undefined ratio. Unpaid
credit cannot be represented as paid; collection/eligibility applies before use.
Refunds and restorations reference original consumed lot deltas, never today's
ratio. Legacy unknown ratios remain unverified and earn no invented amount.

Partition mixed-tender service bases: the credit-funded portion uses only its
original paid-ratio basis for STORED_CREDIT_SPEND; ordinary SERVICE commission
uses only the non-credit-funded portion. Never award both kinds on the same
funding slice. Stored-credit sale and later spend are separate approved events,
not duplicate ordinary-service earnings. Explicit FOC uses a snapshotted list price
and configured default (approved default 5%); zero-price alone is not FOC. Package
redemption and FOC are mutually exclusive on the same service event.

## Period and permission integration

Periods store explicit [startsAt, endsAt) UTC instants and company IANA timezone.
Do not hard-code calendar months or Singapore. Boundaries/timezone are immutable;
database rejects overlapping periods, unknown timezones, and lock without approval.
Approval, lock and actual payment are independent. Server posting time chooses an
open period for reversals/corrections; never reopen history or silently choose an
arbitrary future period. Wrong-staff correction reverses original and reposts with
new staff snapshots, linked correction identity and reason, in one transaction.

Public routes must enforce current membership, token/disabled status, company
module entitlement, write state and owner 2FA using existing guards. Tenant
SUPER_ADMIN means salon administrator, not PlatformAdmin; no platform payroll
authority is implied. MANAGER/SUPER_ADMIN manage rates, override eligibility,
approve/lock and correct earnings; STAFF may only record authorized POS attribution
and eventually view their own statement if expressly exposed. No all-staff salary
access. Internal postCommission validates enabled actor and tenant references,
but source permissions and evidence existence remain the integrating caller's duty;
it is not a public endpoint. Manual adjustment/reversal additionally requires salon
manager/admin. Period APIs and payment-state audit are SC-005, not delivered here.

## Remaining release work

SC-003 evidence checkpoint (October 26, 2026): POS now captures append-only redemption
coverage, original ordinal valuation and own-rate candidate snapshots, with linked
evidence corrections/voids. No new EmployeeCommission postings are enabled. Whole-set
performers can be explicit on the tender; inference is allowed only when every covered
line has the same split. Conflicting/missing splits stay unknown; no service-price
weighting is introduced. Required-attribution policies are optional by default and
can require sellers, service performers and/or resolved redemption performers.
Managers/admins can publish these requirements in Settings → Team & commissions with
a reason and revision check. Suspended salons see read-only controls; stale drafts must
be explicitly reloaded. This attribution policy is not a financial activation switch.
An internal posting seam now validates immutable source/value/rate evidence, rejects
legacy and mutually exclusive covered-line earnings, and links version-1 money to its
attribution revision. It has no normal POS/route caller and does not authorize paid-session
eligibility. Corrections reverse all active linked earnings and repost the corrected
own-rate split transactionally; voids reverse active earnings exactly. Both require the
period containing current server time, never a future period or reopened history.
Unknown/incompatible/unlinked financial evidence fails closed. Snapshot candidate amounts
remain evidence, not earnings, paid-session eligibility, collection evidence or report
totals; `PENDING_RELEASE` remains unchanged even in synthetic internal posting tests.

SC-003: attribution and mutually exclusive event integration; SC-004: package
catalogue validation/configuration and activation policy; SC-006: persisted explicit
allocation/ratios, refund deltas, eligibility and audited overrides; SC-005: report
cutover, correction links, approval/lock/payment APIs and exact export reconciliation.
These are downstream dependencies, not claims of implemented behavior. No unresolved
foundation policy blocker; all algorithms above require scenario/acceptance tests
when their persistence and public workflows are implemented.
