/**
 * The void step — a manager's reason and optional explicit cash attestation.
 *
 * A void is the one till action that takes a receipt off the books, so the dialog asks
 * for the thing that makes it auditable and then gets out of the way. The reason is
 * required by `voidSaleSchema` (three characters, which is the floor this repeats so the
 * button can say when it becomes reachable) and the **actor is not a field at all** — the
 * API takes it from the verified token, because a caller who could name who voided
 * something could name somebody else (ADR 0016).
 *
 * It warns before the fact rather than after: the sale keeps its number and its lines, a
 * void cannot be undone, and the customer has to be refunded outside the till.
 */
import { useState } from "react";
import type { VoidSaleInput } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import { CONTROL_CLASS } from "@/components/ui/Field";
import Modal from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

/** `voidSaleSchema`'s floor, repeated so the button can say when it is reachable. */
const MIN_REASON = 3;

export interface VoidSaleDialogProps {
  /** Which receipt is being voided, so a manager with two open knows which one this is. */
  receiptLabel: string;
  /** The write is in flight; every control freezes so one attempt stays one attempt. */
  isPending: boolean;
  /** The server's refusal, shown above the reason. */
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: (reason: string, cashDisposition?: VoidSaleInput["cashDisposition"]) => void;
}

export default function VoidSaleDialog({
  receiptLabel,
  isPending,
  errorMessage,
  onClose,
  onConfirm,
}: VoidSaleDialogProps) {
  const [reason, setReason] = useState("");
  const [noMoneyMoved, setNoMoneyMoved] = useState(false);
  const trimmed = reason.trim();

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
            disabled={trimmed.length < MIN_REASON}
            onClick={() => onConfirm(trimmed, noMoneyMoved ? "NO_MOVEMENT" : undefined)}
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
            Recorded against the sale with your name. A void cannot be undone and does not return
            customer money. Any separate return must be reconciled before payroll.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-ink-body">
          <input
            type="checkbox"
            checked={noMoneyMoved}
            disabled={isPending}
            onChange={(event) => setNoMoneyMoved(event.target.checked)}
          />
          <span>
            I confirm no customer money was returned or moved outside the till for this void. Leave
            unchecked if money was returned, settlement was cancelled, or you are unsure.
            Unconfirmed cash treatment will block payroll reconciliation for this sale.
          </span>
        </label>
      </div>
    </Modal>
  );
}
