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
import { useEffect, useState } from "react";
import SecureLinkActions from "@/components/ui/SecureLinkActions";

import {
  CUSTOMER_RECEIPT_CSS,
  renderCustomerReceipt,
  type SaleDetail,
} from "@glampro_suite/shared";

import { CheckCircle, Mail, Printer } from "@/components/icons";
import EmailReceiptDialog from "@/components/sale/EmailReceiptDialog";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
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
  const { locale, timeZone, salonName, salonLogoUrl } = useSalonFormatting();
  const [emailOpen, setEmailOpen] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [paper, setPaper] = useState("standard");
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${salonName ? `${salonName} — ` : ""}Receipt${sale.receiptNumber === null ? "" : ` #${sale.receiptNumber}`}`;
    return () => {
      document.title = previousTitle;
    };
  }, [salonName, sale.receiptNumber]);
  // A refunded sale still stands on the books, so neither action is offered again: the
  // server records one refund per sale and refuses a void of a refunded one.
  const refunded = sale.refundedAt !== null;
  // A void is only reachable from a sale that stands: a voided one has nothing left to
  // take off the books, and the service says the same thing.
  const voidable = sale.status === "COMPLETED" && canVoid && !refunded;
  const refundable = sale.status === "COMPLETED" && canRefund && !refunded;
  const receiptLabel = sale.receiptNumber === null ? "This sale" : `Receipt #${sale.receiptNumber}`;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface p-5 print:hidden">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
            {historical ? "Sale history" : "Checkout confirmation"}
          </p>
          <p className="mt-1 flex items-center gap-2 text-xl font-heavy text-ink">
            {!historical && sale.status !== "VOID" && !refunded ? (
              <CheckCircle aria-hidden className="shrink-0 text-success-text" />
            ) : null}
            {sale.status === "VOID"
              ? "Sale voided"
              : refunded
                ? "Sale refunded"
                : historical
                  ? "Receipt details"
                  : "Sale completed"}
          </p>
          {!historical && sale.status !== "VOID" && !refunded ? (
            <div role="status" className="mt-1 text-sm text-ink-body">
              <p>
                {sale.receiptNumber === null
                  ? "The sale is rung up. It will get a receipt number shortly."
                  : `Sale rung up as receipt #${sale.receiptNumber}.`}
              </p>
              <p className="mt-1 text-ink-muted">
                {priceToCents(sale.outstandingAmount) > 0
                  ? " An outstanding balance remains on the customer's account."
                  : " You can print or send the receipt, or start the next sale."}
              </p>
            </div>
          ) : null}
        </div>
        <Button onClick={onNewSale} className="w-full sm:w-auto">
          {returnLabel}
        </Button>
      </div>
      <section
        aria-label="Receipt actions"
        className="flex flex-wrap items-center justify-between gap-3 print:hidden"
      >
        <p className="text-sm text-ink-muted">Print a copy or send this receipt to the customer.</p>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button
            variant="secondary"
            className="flex-1 sm:flex-none print:hidden"
            onClick={() => window.print()}
          >
            <Printer aria-hidden />
            Print
          </Button>
          <Button
            variant="secondary"
            className="flex-1 sm:flex-none"
            onClick={() => setEmailOpen(true)}
          >
            <Mail aria-hidden />
            Email receipt
          </Button>
          <Button
            variant="ghost"
            className="flex-1 sm:flex-none"
            onClick={() => setSharingOpen(true)}
          >
            Share receipt
          </Button>
        </div>
      </section>
      <style>{CUSTOMER_RECEIPT_CSS}</style>
      <div
        className="receipt-print-root"
        data-receipt-paper={paper}
        dangerouslySetInnerHTML={{
          __html: renderCustomerReceipt(sale, {
            name: salonName,
            logoUrl: salonLogoUrl,
            locale,
            timeZone,
          }),
        }}
      />
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
        <details
          aria-label="Sale management"
          className="rounded-card border border-line bg-surface p-4 print:hidden"
        >
          <summary className="min-h-control cursor-pointer content-center font-bold text-ink">
            Sale management
          </summary>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
            <p className="text-sm text-ink-muted">
              Refunds and voids require confirmation. A void does not return money.
            </p>
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
          </div>
        </details>
      ) : null}
      <Modal open={sharingOpen} onClose={() => setSharingOpen(false)} title="Share receipt">
        <SecureLinkActions
          key={sale.id}
          resource="sales"
          id={sale.id}
          receipt
          /* A receipt can only be messaged to a customer on file — `queueReceipt`
             refuses a sale without one, so the dialog says so before the click. */
          canMessage={sale.customerId !== null}
        />
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
