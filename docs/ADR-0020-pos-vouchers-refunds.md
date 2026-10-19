# ADR 0020 — POS vouchers and recorded refunds

Status: Implementation record reconstructed from the supplied task handoff on
October 19, 2026. The original ADR was not found. The user subsequently approved
the L2 + E1 + R1 + A1 + P1 policies below on October 19, 2026.
User accepted UAT for the delivered voucher/refund and policy slice on
October 19, 2026. This does not close the remaining TK2610-0017 POS scope.

## Vouchers (V1 / D1)

Managers publish tenant-scoped percentage or fixed campaigns. The till submits one
normalized code, not a discount amount. Only SERVICE and PRODUCT lines qualify.
Manual discounts and vouchers are exclusive, including held-sale completion.

Preview uses current catalogue/member pricing without consuming availability.
Completion revalidates and claims a redemption transactionally. Allocate the
discount proportionally, with the last eligible line taking the rounding remainder;
recompute inclusive GST on net lines. Store both pre-voucher and net totals.
Database uniqueness permits one redemption per sale. A void restores availability;
a refund leaves the voucher consumed.

## Recorded full-sale refunds (R1)

Manager-only action requires a reason and explicit restock choice. Authentication
supplies the actor; the stored sale supplies the total. This records money returned
outside the till, not a payment-provider transfer.

Append one SaleRefund. Preserve COMPLETED status, receipt number, lines and tenders.
Retries preserve the first audit record without repeating stock/points changes.
Restock PRODUCT lines only when requested. Offset net earned points with a negative
ledger entry. Refund and void serialize on the sale row; both cannot succeed.
Browser and email receipts disclose vouchers and recorded refunds.

## Approved loyalty policy (L2 / E1)

For each line, floor(catalogue points × quantity × discounted net line amount ÷
applicable pre-discount member/nonmember line amount). The net includes manual or
allocated voucher discounts. Zero-priced and fully discounted lines earn zero.
Award at completion regardless of tender or debt; walk-ins have no customer ledger.
Snapshot base points, original amount, net amount and calculated result. Null
snapshots mean pre-policy history, not zero; do not backfill/recalculate awards.
Full refund/void appends a negative ledger entry, without rewriting history.

## Approved refund boundary and payouts (R1 / P1)

Refund only fully paid SERVICE/PRODUCT sales backed by recorded money tenders.
Reject debt records (including previously settled debt), insufficient recorded
funding, redemption funding and any package/value-package/gift-card grant line.
Require actual positive cent-exact money payout splits totaling the sale amount;
never infer the return method from the original tender. Store the first payout
split and preserve it on retry. This records an external return, never a transfer.
Keep explicit restock choice and leave the voucher consumed. Historical refunds
have null payouts; reports must not invent methods for them.

## Approved refund accounting (A1)

Keep the original completed sale and performance in their original period. Report
gross sales, discounts, refunds and net revenue separately; recognize refund money,
inclusive GST reversal and attributable negative performance on the refund date.
Separate incoming tender totals from outgoing refund payouts. Item/service tables
remain gross sales rankings (after discounts), not refund-date net movement tables.

Append negative unpaid-commission rows. `paidAt` explicitly identifies paid
commissions; flag those originals `reconciliationRequired` instead of claiming a
recovery. Report their count by refund date. Existing rows default unpaid because
the prior schema recorded no payment state; reconcile legacy payouts before use.
No commission-payment/reconciliation workflow or automatic commission generation
is introduced in this slice. All reversal writes share the refund transaction and
sale-row lock, so retries do not repeat adjustments.

## Remaining limits

- Voucher publishing is API-only. Historical sale browsing, tips, barcode scanning
  and hold integrity/completeness review remain outside the accepted slice of
  TK2610-0017. UAT for the delivered slice is accepted.
