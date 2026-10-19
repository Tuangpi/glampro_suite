/**
 * The refund step — a manager records that a sale's money went back.
 *
 * A refund is not a void (ADR 0020): the sale stays completed, keeps its receipt
 * number and its lines, and the refund row beside it is the record of the money. So
 * this dialog asks for evidence the server cannot infer:
 *
 * - **Why**, because the refund is auditable beside the sale it reverses.
 * - **Whether the goods came back**, because "we put the shampoo back on the shelf"
 *   and "the customer kept it" are different stock facts. The manager must choose.
 *
 * - Actual money return methods and amounts, whose sum must equal the server's total.
 * The client cannot choose the refundable total. The actor comes from the token.
 */
import { useState } from "react";
import {
  MAX_SALE_PAYMENTS,
  PAYMENT_METHODS,
  isRedemptionPaymentMethod,
  type RefundSaleInput,
} from "@glampro_suite/shared";
import { PAYMENT_METHOD_LABELS } from "@/constants/sale";
import { centsToPrice, priceToCents } from "@/lib/money";

import Button from "@/components/ui/Button";
import { CONTROL_CLASS } from "@/components/ui/Field";
import Modal from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

/** `refundSaleSchema`'s floor, repeated so the button can say when it is reachable. */
const MIN_REASON = 3;

export interface RefundSaleDialogProps {
  /** Which receipt is being refunded, so a manager with two open knows which one this is. */
  receiptLabel: string;
  /** What the refund will be — the server's own total, shown so nobody guesses. */
  amountLabel: string;
  amount: string;
  /** The write is in flight; every control freezes so one attempt stays one attempt. */
  isPending: boolean;
  /** The server's refusal, shown above the reason. */
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: (input: RefundSaleInput) => void;
}

export default function RefundSaleDialog({
  receiptLabel,
  amountLabel,
  amount,
  isPending,
  errorMessage,
  onClose,
  onConfirm,
}: RefundSaleDialogProps) {
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState<boolean | null>(null);
  const trimmed = reason.trim();
  const [payouts, setPayouts] = useState<
    { method: RefundSaleInput["payouts"][number]["method"] | ""; amount: string }[]
  >([{ method: "", amount }]);
  const validPayouts =
    payouts.every(
      (row) =>
        row.method !== "" && /^\d+(\.\d{1,2})?$/.test(row.amount) && priceToCents(row.amount) > 0,
    ) && payouts.reduce((sum, row) => sum + priceToCents(row.amount), 0) === priceToCents(amount);

  return (
    <Modal
      open
      onClose={onClose}
      title="Refund this sale"
      description={`${receiptLabel} keeps its number and its lines. Record the ${amountLabel} refund only after returning the money outside the till. This does not transfer money.`}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={isPending} onClick={onClose}>
            Keep the sale
          </Button>
          <Button
            variant="danger"
            loading={isPending}
            disabled={trimmed.length < MIN_REASON || restock === null || !validPayouts}
            onClick={() => {
              if (restock !== null && validPayouts)
                onConfirm({
                  reason: trimmed,
                  restock,
                  payouts: payouts.map((row) => ({
                    method: row.method as RefundSaleInput["payouts"][number]["method"],
                    amount: Number(row.amount),
                  })),
                });
            }}
          >
            Record refund {amountLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {errorMessage ? (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {errorMessage}
          </p>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-ink-body">Why is this being refunded?</span>
          <textarea
            value={reason}
            rows={3}
            maxLength={500}
            disabled={isPending}
            aria-label="Reason for refunding this sale"
            onChange={(event) => setReason(event.target.value)}
            className={cn(CONTROL_CLASS, "min-h-20 px-3 py-2")}
          />
          <span className="text-xs text-ink-muted">
            Recorded against the sale with your name. A full-sale refund is recorded once and cannot
            be undone from the till.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-ink-body">Restock returned products?</span>
          <select
            aria-label="Restock returned products?"
            value={restock === null ? "" : String(restock)}
            disabled={isPending}
            onChange={(event) =>
              setRestock(event.target.value === "" ? null : event.target.value === "true")
            }
            className={cn(CONTROL_CLASS, "h-control px-3")}
          >
            <option value="">Choose an option</option>
            <option value="true">Yes — the products came back</option>
            <option value="false">No — do not change stock</option>
          </select>
          <span className="text-xs text-ink-muted">Services and packages are never restocked.</span>
        </label>
        <fieldset disabled={isPending} className="flex flex-col gap-2">
          <legend className="text-xs font-bold text-ink-body">How was the money returned?</legend>
          {payouts.map((row, index) => (
            <div key={index} className="flex gap-2">
              <select
                aria-label={`Refund method ${index + 1}`}
                value={row.method}
                className={cn(CONTROL_CLASS, "h-control px-3")}
                onChange={(event) =>
                  setPayouts((current) =>
                    current.map((item, i) =>
                      i === index
                        ? { ...item, method: event.target.value as typeof row.method }
                        : item,
                    ),
                  )
                }
              >
                <option value="">Choose method</option>
                {PAYMENT_METHODS.filter((method) => !isRedemptionPaymentMethod(method)).map(
                  (method) => (
                    <option key={method} value={method}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </option>
                  ),
                )}
              </select>
              <input
                aria-label={`Refund amount ${index + 1}`}
                inputMode="decimal"
                value={row.amount}
                className={cn(CONTROL_CLASS, "h-control w-28 px-3")}
                onChange={(event) =>
                  setPayouts((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, amount: event.target.value } : item,
                    ),
                  )
                }
              />
              {payouts.length > 1 ? (
                <Button
                  variant="ghost"
                  onClick={() => setPayouts((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
          <Button
            variant="secondary"
            disabled={payouts.length >= MAX_SALE_PAYMENTS}
            onClick={() =>
              setPayouts((current) => [
                ...current,
                {
                  method: "",
                  amount: centsToPrice(
                    Math.max(
                      0,
                      priceToCents(amount) -
                        current.reduce((sum, row) => sum + priceToCents(row.amount), 0),
                    ),
                  ),
                },
              ])
            }
          >
            Add refund method
          </Button>
          {!validPayouts ? (
            <p className="text-xs text-ink-muted">
              Choose the actual methods and amounts. Their total must equal {amountLabel}.
            </p>
          ) : null}
        </fieldset>
      </div>
    </Modal>
  );
}
