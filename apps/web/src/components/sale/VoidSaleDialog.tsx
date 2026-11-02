/**
 * The void step — a manager's reason and, when they know it, what happened to the money.
 *
 * A void is the one till action that takes a receipt off the books, so the dialog asks
 * for the thing that makes it auditable and then gets out of the way. The reason is
 * required by `voidSaleSchema` (three characters, which is the floor this repeats so the
 * button can say when it becomes reachable) and the **actor is not a field at all** — the
 * API takes it from the verified token, because a caller who could name who voided
 * something could name somebody else (ADR 0016).
 *
 * The cash question is one radio group rather than two checkboxes, because a void either
 * returned the money or it did not: `voidSaleSchema` refuses a request that says both or
 * neither, and the dialog should not be able to post one. Where the receipt is not a
 * purchase or prepaid-funded receipt, the returned option is not offered — an ordinary
 * money-paid sale uses a refund. Prepaid usage restores separately and is never cash.
 */
import { useState } from "react";
import {
  MONEY_PAYMENT_METHODS,
  type MoneyPaymentMethodCode,
  type VoidSaleInput,
} from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import { CONTROL_CLASS } from "@/components/ui/Field";
import Modal from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

/** `voidSaleSchema`'s floor, repeated so the button can say when it is reachable. */
const MIN_REASON = 3;
/** The reference is what somebody can look up later, so one character is not one. */
const MIN_REFERENCE = 3;

export interface VoidSaleDialogProps {
  /** Which receipt is being voided, so a manager with two open knows which one this is. */
  receiptLabel: string;
  /** What the till took on this receipt. A giving-back returns that, not a typed figure. */
  paidAmount: string;
  /** The same figure as the salon prints it, so the dialog says what it is returning. */
  paidAmountLabel: string;
  /** Eligible purchase or prepaid-funded usage with external money to return. */
  canReturnMoney: boolean;
  /** The write is in flight; every control freezes so one attempt stays one attempt. */
  isPending: boolean;
  /** The server's refusal, shown above the reason. */
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: (
    reason: string,
    cash: Pick<VoidSaleInput, "cashDisposition" | "returnedCash">,
  ) => void;
}

/** What the manager saw happen to the customer's money, if they said anything at all. */
type MoneyChoice = "UNCONFIRMED" | "NO_MOVEMENT" | "RETURNED";

export default function VoidSaleDialog({
  receiptLabel,
  paidAmount,
  paidAmountLabel,
  canReturnMoney,
  isPending,
  errorMessage,
  onClose,
  onConfirm,
}: VoidSaleDialogProps) {
  const [reason, setReason] = useState("");
  const [money, setMoney] = useState<MoneyChoice>("UNCONFIRMED");
  const [method, setMethod] = useState<MoneyPaymentMethodCode>("CASH");
  const [reference, setReference] = useState("");
  const trimmed = reason.trim();
  const trimmedReference = reference.trim();
  const returned = money === "RETURNED";
  const unreachable = returned && trimmedReference.length < MIN_REFERENCE;

  return (
    <Modal
      open
      onClose={onClose}
      title="Void this sale"
      description={`${receiptLabel} comes off the books. Its number, its lines and who rang it up all stay.`}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={isPending} onClick={onClose}>
            Keep the sale
          </Button>
          <Button
            variant="danger"
            loading={isPending}
            disabled={trimmed.length < MIN_REASON || unreachable}
            onClick={() =>
              onConfirm(
                trimmed,
                returned
                  ? {
                      cashDisposition: "RETURNED",
                      returnedCash: {
                        reference: trimmedReference,
                        payouts: [{ method, amount: Number(paidAmount) }],
                      },
                    }
                  : money === "NO_MOVEMENT"
                    ? { cashDisposition: "NO_MOVEMENT" }
                    : {},
              )
            }
          >
            Void it
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

        {/* A raw textarea rather than a shared primitive: the app has no multi-line
            field yet, and inventing one for a single caller would be the wrong order. */}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-ink-body">Why is this being voided?</span>
          <textarea
            value={reason}
            rows={3}
            maxLength={500}
            disabled={isPending}
            aria-label="Reason for voiding this sale"
            onChange={(event) => setReason(event.target.value)}
            className={cn(CONTROL_CLASS, "min-h-20 px-3 py-2")}
          />
          <span className="text-xs text-ink-muted">
            Recorded against the sale with your name. A void cannot be undone, and payroll
            reconciles it from what you say happened to the customer&apos;s money below.
          </span>
        </label>
        {/* One question, three answers: nothing said, nothing moved, or the money went
            back. Two checkboxes could be ticked at once and would then contradict each
            other, which is exactly what `voidSaleSchema` refuses on the wire. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-bold text-ink-body">
            What happened to the customer&apos;s money?
          </legend>
          <label className="flex items-start gap-2 text-sm text-ink-body">
            <input
              type="radio"
              name="void-cash"
              checked={money === "UNCONFIRMED"}
              disabled={isPending}
              onChange={() => setMoney("UNCONFIRMED")}
            />
            <span>I am not saying. Payroll will hold this sale until it is confirmed.</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-ink-body">
            <input
              type="radio"
              name="void-cash"
              checked={money === "NO_MOVEMENT"}
              disabled={isPending}
              onChange={() => setMoney("NO_MOVEMENT")}
            />
            <span>No customer money was returned or moved outside the till.</span>
          </label>
          {canReturnMoney ? (
            <label className="flex items-start gap-2 text-sm text-ink-body">
              <input
                type="radio"
                name="void-cash"
                checked={returned}
                disabled={isPending}
                onChange={() => setMoney("RETURNED")}
              />
              <span>
                I returned the {paidAmountLabel} this sale collected, in full. Payroll takes it back
                out of this month&apos;s cash.
              </span>
            </label>
          ) : null}
        </fieldset>
        {returned ? (
          <div className="flex flex-col gap-3 rounded-md bg-surface-sunken px-3 py-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-ink-body">How was it given back?</span>
              <select
                value={method}
                disabled={isPending}
                aria-label="Method the money was returned in"
                onChange={(event) => setMethod(event.target.value as MoneyPaymentMethodCode)}
                className={cn(CONTROL_CLASS, "px-3 py-2")}
              >
                {MONEY_PAYMENT_METHODS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-ink-body">
                What can somebody look up later?
              </span>
              <input
                value={reference}
                maxLength={100}
                disabled={isPending}
                aria-label="Reference for the returned money"
                placeholder="Void slip, bank transfer reference or till note"
                onChange={(event) => setReference(event.target.value)}
                className={cn(CONTROL_CLASS, "px-3 py-2")}
              />
              <span className="text-xs text-ink-muted">
                The amount is the {paidAmountLabel} this sale collected — a returned void gives all
                of it back, and the server refuses any other figure. Prepaid credit or sessions
                restore to the original holding, never as a cash payout.
              </span>
            </label>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
