# Session-package valuation policy — version 1

Status: **APPROVED FOR IMPLEMENTATION** — October 24, 2026.
Policy version: **1**. The user approved the draft's seven approval points in full.
The existing filename is retained to preserve references to the reviewed document.

This is an approved application-reporting specification, not a determination of
statutory revenue recognition, tax liability or required accounting treatment.
This approval authorizes local implementation of the valuation rules, not application
database migration, deployment or changes to statutory accounting or tax treatment.
Existing GST, sales, refund and prepaid-credit calculations remain unchanged.

## 1. Purpose and scope

Report the original discounted purchase value allocated to unused session
entitlements, separately from prepaid credit, gift cards and customer receivables.
Use the label **Remaining package purchase value**, not an unqualified claim of
complete accounting liability. Keep operational session counts alongside it.

First release: company-wide **current snapshot**, shared across outlets, plus an
auditable movement reconciliation starting at valuation activation. No arbitrary
historical closing balances before activation and no automatic accounting entries.
No new refund, expiry-extension, partial-transfer or service-level valuation feature.

## 2. Purchase-time value

Use the final package sale-line consideration after all discounts actually applied
to that line, not the catalogue price or the value of services at redemption time.
Manual discounts are already reflected in lineTotal; do not subtract them twice.
Subtract any stored line-attributed voucher discount once.

Approved basis:

    gross purchase value = lineTotal - voucherDiscountAmount
    net purchase value = gross purchase value - stored line taxAmount

Snapshot gross, stored GST and net separately, using the original sale currency and
policy version. Validate that they reconcile and are nonnegative. Show **net remaining
purchase value** as the primary measure, with gross and original-tax
components available separately. Do not combine this with the current prepaid/gift
card total under a new grand total: their bases are not established as equivalent.

This policy only allocates the tax already stored on the package purchase. It
does not decide whether GST should legally arise at purchase or redemption, and
does not adjust GST returns, receipt taxes or sales-tax reports. The net reporting
basis is approved for this application report; it is not a statutory tax opinion.

Zero-priced/fully discounted purchases have known zero value, not unknown value.
Held carts have no valuation grant; snapshot only when a sale completes.

## 3. Session allocation and exact cents

Allocate equally across the total sessions granted by the holding, including all
package units bought on its sale line. For a service-set package, each session means
one whole purchased set. For a per-unit package, each redeemed session releases
one equal share regardless of the service selected or its later catalogue price.
Do not allocate unequal values to the individual services inside a set in this release.

Use integer minor units. Assign each original session a stable ordinal:

1. Base cents = integer division of purchase value cents by granted sessions.
2. Give one additional cent to each of the first remainder-number of ordinals.
3. Allocate net and original-tax components independently; a session's gross is
   their sum, so gross = net + original tax at every movement and in total.
4. Redeem the lowest available ordinals first. Persist the ordinal allocations or
   equivalent immutable ranges on each redemption.
5. Void restores those exact ordinals and their exact values, not a newly rounded
   share. Never recalculate using current prices or a current GST rate.

This allocation need not create one database row per session; compact immutable
ranges may implement the same rule. Value and count must always reconcile.

## 4. Unpaid and partially paid purchases

The approved measure is based on **contracted purchase consideration**, not cash collected.
If existing software grants all sessions on a completed unpaid/part-paid purchase,
include their full allocated purchase value and show the associated outstanding
receivable separately. Do not silently net receivables against package value or
reduce session value when an outstanding payment is subsequently collected.

Display the count/value of holdings linked to unpaid purchases so users can see
this distinction. Do not infer a per-package cash allocation from a mixed sale's
payments. Cash-backed liability would need a separate approved allocation policy.

## 5. Redemption, transfer and reversal

- Redemption removes the allocated value of the sessions actually consumed. Call
  this **value released by redemption**, not automatically recognised revenue.
- Redemption void restores the original allocation once only. If ownership moved,
  the holding's current owner receives the restored entitlement and value.
- Same-company whole-holding transfer moves the unspent session/value ownership,
  preserving expiry, rule snapshots and original session ordinals. Company totals
  do not change. Record transfer-out/in for customer-level reconciliation without
  counting either as company-wide value creation or release.
- Original purchase void removes its grant only where existing reversal rules
  permit it. Purchases with transfer history remain non-voidable. Preserve valuation
  evidence even if the existing holding is deleted by an allowed purchase void.
- Existing package-purchase and package-funded-sale refund exclusions remain.
  Do not introduce a monetary package refund merely to complete this report.
- Stock, commissions and existing GST/revenue reporting retain their current rules.

## 6. Expiry

At the exact stored expiry instant, remaining sessions become unavailable under
existing rules. Move their allocated value from **active remaining value** to
**expired unused value**, shown separately. Do not delete the valuation history or
silently call expired value recognised revenue, a tax adjustment or a refund.

A redemption void after expiry restores the original session/value allocation to
the expired bucket, not the active bucket. No automatic extension or reactivation.
No-expiry holdings remain active until consumed or an allowed reversal removes them.

## 7. Existing and incomplete data

Never use today's catalogue price as a substitute for missing purchase evidence.
Backfill known values only when the original sale line, currency, original granted
session count, discount/tax facts and relevant allocation history can be verified.
Ambiguous multi-holding allocations and inconsistent counts are **unvalued**, not zero.

If the existing remaining count and purchase basis are reliable but earlier
redemption/reversal allocations cannot be reconstructed unambiguously, do not
invent original consumed ordinals. Keep the holding unvalued in the first release.
Any later opening-balance reconciliation requires a separately approved, attributed
amount/source/reason and effective date; no silent historical rewrite.

Show both valued and unvalued holdings/session counts. Warn **Incomplete valuation**
whenever relevant unvalued sessions remain. Expired unknown values are also flagged
as unknown rather than disappearing from the reconciliation. An initial release may
therefore provide complete valuation only for purchases after activation.

## 8. Reconciliation and controls

For each currency and the valuation period since activation:

    opening active value
    + purchase grants
    + redemption-void restorations to active
    - redemption releases
    - allowed purchase-void removals from active
    - expiry movements out of active
    = closing active value

Track corresponding expired-bucket movements, including restorations after expiry
and any permitted purchase void removing an expired grant. Transfers cancel at
company level and appear as paired movements at customer level. Reconcile net,
original-tax, gross and session counts separately. Do not sum different currencies.

Commit valuation movements with the existing purchase/redemption/transfer/void
transaction. Expiry transitions must be deterministic and idempotent, with an
effective expiry time even if recorded later. One report snapshot uses one coherent
database snapshot and one as-of instant, so concurrent transactions cannot make its
counts and monetary movement totals disagree. Preserve events through ordinary
holding deletion; follow existing company-deletion/retention constraints.

Snapshot policy version, original sale/line/holding identifiers, original currency,
granted count, net/tax/gross cents and original expiry. Movement evidence records
source action, allocated session ordinals/ranges, quantity, amount, effective time,
recording time and real actor where available. System expiry is labelled as system,
not attributed to a staff member. Retries must not duplicate movements.

## 9. Worked examples

### Discounted package, no GST in this example

List price $600, actual discounted package purchase $540, six sessions. Each session
has $90 value. After two redemptions: four sessions / $360 active remaining value.
Transferring the holding keeps the company total at $360. Voiding one prior
redemption restores $90 to its current owner: five sessions / $450.

### Exact cents

Net purchase $100, original tax $0, three sessions. Ordinals 1/2/3 receive
$33.34/$33.33/$33.33. Redeeming ordinal 1 leaves $66.66; redeeming ordinal 2 leaves
$33.33. Voiding the first redemption restores exactly $33.34, leaving $66.67.
This is expected: different available ordinals can differ by one cent, but the
original purchase and every movement still reconcile exactly.

### Stored tax, not a tax-policy determination

Original purchase gross $109, stored tax $9, net $100, five sessions. Each carries
$20 net plus $1.80 original-tax allocation. After two are redeemed: $60 net / $5.40
original tax / $65.40 gross remains. These allocated components do not alter the
original sale's stored GST or create a new tax entry at redemption.

### Unpaid purchase and expiry

Completed $540 package purchase grants six sessions while $200 remains receivable.
With four sessions unused, report $360 remaining purchase value and the $200
receivable separately; do not report $160 as package value. On expiry, move $360
from active to expired-unused value without claiming revenue recognition.

## 10. Approval record

The user's October 24, 2026 approval covers all seven points:

1. Equal allocation per purchased session/whole service set, not service retail value.
2. Discounted purchase consideration; net basis with original tax/gross
   components separate; no combined prepaid/package grand total.
3. Full contracted value for completed unpaid purchases, receivables separately.
4. Exact-cent ordinal allocation, exact restoration and current-owner transfer rules.
5. Expired value separately disclosed, no automatic accounting revenue recognition.
6. Unknown historical values flagged/unvalued; no invented backfill or silent zero.
7. Current snapshot and movements since activation only, not retrospective closings.

The policy blocker on VALUE-01 is removed. Recording this approval does not itself
implement valuation snapshots, movements or report behaviour. See
`package-valuation-implementation.md` for the implementation and verification plan.
