/**
 * The receipt — handoff screen 02's confirmation, drawn from the body
 * `POST /api/sales` returned.
 *
 * **This screen *is* the receipt** (`docs/roadmap.md` → Phase 5d), which is why
 * the API answers the write with the whole `saleDetailSchema` instead of a bare
 * id: there is no second read and no second representation that could disagree
 * with what was stored. `GET /api/sales/:id` returns the same shape, so re-opening
 * a past sale draws through this component unchanged (full phase).
 *
 * Every number here is the **server's**, formatted for display and never
 * recomputed: the cart's totals were estimates from the prices the search
 * returned, while the receipt is what the catalogue actually charged. `Change` is
 * the one subtraction — `paidAmount - totalAmount` — and it is drawn as an
 * outstanding balance instead when it runs the other way, because a short tender
 * is a debt (`CustomerOutstanding`) and not negative change.
 *
 * A **voided** sale draws through this same component with a banner and a badge, which is
 * the point of a void being a state change rather than a delete: the receipt is still a
 * receipt, and it has to say what it now is (ADR 0016).
 */
import { useState } from "react";
import SecureLinkActions from "@/components/ui/SecureLinkActions";

import type { SaleDetail } from "@glampro_suite/shared";

import { CheckCircle, Mail, Printer } from "@/components/icons";
import EmailReceiptDialog from "@/components/sale/EmailReceiptDialog";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import { PAYMENT_METHOD_BADGE, PAYMENT_METHOD_LABELS } from "@/constants/sale";
import { priceToCents } from "@/lib/money";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

export interface ReceiptViewProps {
  sale: SaleDetail;
  /** Returns to the till; historical browsing preserves the existing cart. */
  onNewSale: () => void;
  returnLabel?: string;
  /** Historical receipts must not announce a newly completed transaction. */
  historical?: boolean;
  /**
   * The customer's saved address, prefilled in the email dialog (TK2610-0010). `null`
   * for a walk-in or a customer who never gave one — the cashier can still type one.
   */
  customerEmail: string | null;
  /**
   * Whether the signed-in user may void — owner or manager (ADR 0016). Only ever used to
   * **hide** the action: the API refuses anybody else with a 403, and a button that
   * always fails is worse than no button.
   */
  canVoid: boolean;
  /** Opens the void dialog. */
  onVoid: () => void;
  /**
   * Whether the signed-in user may record a refund — the same manager gate the void
   * uses (ADR 0020). Used only to hide the action; the API refuses anybody else.
   */
  canRefund: boolean;
  /** Opens the refund dialog. */
  onRefund: () => void;
}

export default function ReceiptView({
  sale,
  onNewSale,
  returnLabel = "New sale",
  historical = false,
  customerEmail,
  canVoid,
  onVoid,
  canRefund,
  onRefund,
}: ReceiptViewProps) {
  const { formatDateTime, formatPrice } = useSalonFormatting();
  const [emailOpen, setEmailOpen] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [paper, setPaper] = useState("standard");
  const changeCents = priceToCents(sale.paidAmount) - priceToCents(sale.totalAmount);
  // A refunded sale still stands on the books, so neither action is offered again: the
  // server records one refund per sale and refuses a void of a refunded one.
  const refunded = sale.refundedAt !== null;
  // A void is only reachable from a sale that stands: a voided one has nothing left to
  // take off the books, and the service says the same thing.
  const voidable = sale.status === "COMPLETED" && canVoid && !refunded;
  const refundable = sale.status === "COMPLETED" && canRefund && !refunded;
  const receiptLabel = sale.receiptNumber === null ? "This sale" : `Receipt #${sale.receiptNumber}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="secondary" onClick={onNewSale}>
          {returnLabel}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
            <Printer aria-hidden />
            Print
          </Button>
          <Button variant="secondary" onClick={() => setEmailOpen(true)}>
            <Mail aria-hidden />
            Email receipt
          </Button>
          <Button variant="secondary" onClick={() => setSharingOpen(true)}>
            Share receipt
          </Button>
        </div>
      </div>
      <div
        className="receipt-print-root grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"
        data-receipt-paper={paper}
      >
        <header className="col-span-full flex flex-col gap-2 rounded-card border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl">{`Receipt ${sale.receiptNumber === null ? "(number pending)" : `#${sale.receiptNumber}`}`}</h2>
            <div className="flex flex-wrap gap-2">
              {sale.status === "VOID" ? (
                <Badge variant="danger">Void</Badge>
              ) : refunded ? (
                <Badge variant="warning">Refunded</Badge>
              ) : (
                <Badge variant="neutral">Completed</Badge>
              )}
              {sale.status !== "VOID" && !refunded ? (
                <Badge variant={priceToCents(sale.outstandingAmount) > 0 ? "warning" : "success"}>
                  {priceToCents(sale.outstandingAmount) > 0 ? "Outstanding balance" : "Paid"}
                </Badge>
              ) : null}
            </div>
          </div>
          <p className="text-sm text-ink-muted">{formatDateTime(sale.soldAt)}</p>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="text-ink-muted">Customer</dt>
              <dd className="font-bold text-ink">{sale.customerName ?? "Walk-in"}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Operator</dt>
              <dd className="font-bold text-ink">{sale.staffName ?? "the till"}</dd>
            </div>
          </dl>
        </header>
        <Card title="Items sold" className="min-w-0">
          {sale.gstRegistrationNumber ? (
            <p className="px-1 pt-2 text-sm text-ink-muted">
              GST registration no.: {sale.gstRegistrationNumber}
            </p>
          ) : null}
          <ul aria-label="Items sold" className="flex flex-col">
            {sale.lines.map((line) => (
              <li
                key={line.id}
                className="flex items-start justify-between gap-4 border-b border-line-soft px-1 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="receipt-item-name break-words font-bold text-ink">
                    {line.itemName}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {line.quantity} × {formatPrice(line.unitPrice)}
                    {line.staffName ? ` · ${line.staffName}` : ""}
                  </p>
                  {/* The disclosure legacy never made: the rate, and the money it took off
                    this line (ADR 0017). Both come from the server's own row. */}
                  {priceToCents(line.discountAmount) > 0 ? (
                    <p className="text-xs text-success-text">
                      {Number(line.discountPercent)}% off · −{formatPrice(line.discountAmount)}
                    </p>
                  ) : null}
                  {/* A voucher's share of this line (ADR 0020). `lineTotal` is the
                    pre-voucher figure, so the amount on the right is `netLineTotal`
                    and the line sums into the sale's total. */}
                  {priceToCents(line.voucherDiscountAmount) > 0 ? (
                    <p className="text-xs text-success-text">
                      Voucher · −{formatPrice(line.voucherDiscountAmount)}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 font-heavy text-ink">
                  {formatPrice(
                    priceToCents(line.voucherDiscountAmount) > 0
                      ? line.netLineTotal
                      : line.lineTotal,
                  )}
                </p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Payment summary" className="min-w-0">
          <dl className="grid gap-3 px-1 pt-2">
            <div className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-3">
              <dt className="font-bold text-ink">Total</dt>
              <dd className="text-xl font-heavy text-ink">{formatPrice(sale.totalAmount)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-ink-muted">Items</dt>
              <dd className="font-bold text-ink">{sale.totalQuantity}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-ink-muted">Points earned</dt>
              <dd className="font-bold text-ink">{sale.pointsEarned}</dd>
            </div>
            {/* One `Discount` row, the figure the server summed over the lines — the
              handoff's own cart draws the same row (ADR 0017). */}
            {priceToCents(sale.discountAmount) > 0 ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-ink-muted">Discount</dt>
                <dd className="font-bold text-success-text">−{formatPrice(sale.discountAmount)}</dd>
              </div>
            ) : null}
            {/* A voucher changes the bill but is not a tender, so it gets its own row
              above the total rather than sitting among the tenders (ADR 0020). */}
            {priceToCents(sale.voucherDiscountAmount) > 0 ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-ink-muted">
                  Voucher{sale.voucherCode === null ? "" : ` ${sale.voucherCode}`}
                </dt>
                <dd className="font-bold text-success-text">
                  −{formatPrice(sale.voucherDiscountAmount)}
                </dd>
              </div>
            ) : null}
            {/* Inclusive GST backed out of the total by the server — the receipt
              shows the component without changing what was charged. */}
            {priceToCents(sale.taxAmount) > 0 ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-ink-muted">Includes GST ({Number(sale.taxRate)}%)</dt>
                <dd className="font-bold text-ink">{formatPrice(sale.taxAmount)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-ink-muted">Tendered</dt>
              <dd className="font-bold text-ink">{formatPrice(sale.paidAmount)}</dd>
            </div>
            {sale.status !== "VOID" ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-ink-muted">
                  {changeCents >= 0 ? "Change" : "Outstanding"}
                </dt>
                <dd className={changeCents >= 0 ? "font-bold text-ink" : "font-bold text-danger"}>
                  {formatPrice(Math.abs(changeCents) / 100)}
                </dd>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">
                Sale reversed. Any money refund must be handled separately.
              </p>
            )}
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2 px-1 pb-1">
            <span className="text-sm text-ink-muted">Tenders</span>
            {sale.payments.length === 0 ? (
              // `payments: []` is a legal sale — the whole balance was left on the
              // customer's account — so this says so rather than drawing nothing.
              <Badge variant="neutral">Nothing tendered — on the account</Badge>
            ) : (
              sale.payments.map((payment, index) => (
                <Badge
                  key={`${payment.method}-${index}`}
                  variant={PAYMENT_METHOD_BADGE[payment.method]}
                  dot
                >
                  {PAYMENT_METHOD_LABELS[payment.method]} {formatPrice(payment.amount)}
                </Badge>
              ))
            )}
          </div>

          {sale.note ? (
            <p className="mt-3 rounded-md bg-surface-2 px-4 py-3 text-sm text-ink-body">
              {sale.note}
            </p>
          ) : null}
        </Card>

        {sale.refundedAt !== null ? (
          // Printed as well as drawn, like the void banner: a reprint of a refunded
          // receipt has to say the money went back, and to whom the record attributes it.
          <div
            role="status"
            className="col-span-full flex flex-col gap-1 rounded-card border border-warning/40 bg-warning-soft px-4.5 py-3.5 text-sm text-ink-body"
          >
            <p className="font-bold text-ink">
              {formatPrice(sale.refundAmount ?? "0.00")} refunded on{" "}
              {formatDateTime(sale.refundedAt)}
              {sale.refundedByName === null ? "" : ` by ${sale.refundedByName}`}.
            </p>
            <p>{sale.refundReason ?? "No reason was recorded."}</p>
            {sale.refundPayouts.map((payout, index) => (
              <p key={index}>
                {PAYMENT_METHOD_LABELS[payout.method]} returned: {formatPrice(payout.amount)}
              </p>
            ))}
            <p className="text-xs text-ink-muted">
              {sale.refundRestocked
                ? "The product lines went back into stock."
                : "The product lines were not restocked."}{" "}
              The sale keeps its number and its lines; the refund is the record of the money.
            </p>
          </div>
        ) : null}

        {sale.status === "VOID" ? (
          // Printed as well as drawn: a sheet that does not say VOID could be filed as a
          // live receipt, which is the one mistake the void exists to prevent.
          <div
            role="status"
            className="col-span-full flex flex-col gap-1 rounded-card border border-danger/40 bg-danger/10 px-4.5 py-3.5 text-sm text-danger"
          >
            <p className="font-bold">
              Voided{sale.voidedAt === null ? "" : ` on ${formatDateTime(sale.voidedAt)}`}
              {sale.voidedByName === null ? "" : ` by ${sale.voidedByName}`}.
            </p>
            <p>{sale.voidReason ?? "No reason was recorded."}</p>
            <p className="text-xs">
              The number, the lines and the tenders stay on the record. This sale no longer counts
              towards any total.
            </p>
          </div>
        ) : !historical && !refunded ? (
          <p
            role="status"
            className="col-span-full flex items-center gap-2 rounded-card border border-line bg-success-soft px-4.5 py-3.5 text-sm text-success-text print:hidden"
          >
            <CheckCircle aria-hidden className="shrink-0" />
            {sale.receiptNumber === null
              ? "The sale is rung up. It will get a receipt number shortly."
              : `Sale rung up as receipt #${sale.receiptNumber}.`}
          </p>
        ) : null}
      </div>
      <details className="rounded-card border border-line bg-surface p-4 print:hidden">
        <summary className="min-h-control cursor-pointer content-center font-bold text-ink">
          Printer settings
        </summary>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <Select
            label="Receipt paper"
            value={paper}
            onChange={(event) => setPaper(event.target.value)}
            options={[
              { value: "standard", label: "Standard page" },
              { value: "80", label: "80 mm thermal" },
              { value: "58", label: "58 mm thermal" },
            ]}
          />
          <p className="max-w-lg text-sm text-ink-muted">
            Thermal selection previews the receipt width. In the print dialog, match the printer
            paper width, use 100% scale and disable headers and footers. Printer margins may need
            adjustment.
          </p>
        </div>
      </details>
      {refundable || voidable ? (
        <section
          aria-label="Sale management"
          className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 print:hidden"
        >
          <div>
            <h3 className="font-bold text-ink">Sale management</h3>
            <p className="text-sm text-ink-muted">
              Refunds and voids require confirmation. A void does not return money.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {refundable ? (
              <Button variant="danger" onClick={onRefund}>
                Refund sale
              </Button>
            ) : null}
            {voidable ? (
              <Button variant="danger" onClick={onVoid}>
                Void sale
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
      <Modal open={sharingOpen} onClose={() => setSharingOpen(false)} title="Share receipt">
        <SecureLinkActions key={sale.id} resource="sales" id={sale.id} receipt />
      </Modal>
      {emailOpen ? (
        <EmailReceiptDialog
          saleId={sale.id}
          receiptLabel={receiptLabel}
          defaultEmail={customerEmail}
          onClose={() => setEmailOpen(false)}
        />
      ) : null}
    </div>
  );
}
