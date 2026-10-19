/**
 * The e-receipt step — an address, and the copy that goes to it (TK2610-0010).
 *
 * The customer's saved address is prefilled, because the common case is one tap, but the
 * field stays editable: a cashier may be sending to a partner or a shared inbox, which is
 * why the API takes the address in the body rather than reading it off the customer row.
 *
 * The address is checked against `emailSaleReceiptSchema` — the same contract the route
 * parses — so the dialog cannot accept something the API would refuse. A successful send
 * stays on screen with the address it reached rather than closing silently: the cashier
 * has to be able to say "it went to this address" without asking the customer.
 */
import { useState } from "react";

import { emailSaleReceiptSchema } from "@glampro_suite/shared";

import { Mail } from "@/components/icons";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { useEmailSaleReceipt } from "@/hooks/useSale";
import { getErrorMessage } from "@/lib/api";

export interface EmailReceiptDialogProps {
  /** Which sale's copy this is. */
  saleId: string;
  /** How the receipt is named on screen, so two open sales cannot be confused. */
  receiptLabel: string;
  /** The customer's saved address, prefilled when there is one. */
  defaultEmail: string | null;
  onClose: () => void;
}

export default function EmailReceiptDialog({
  saleId,
  receiptLabel,
  defaultEmail,
  onClose,
}: EmailReceiptDialogProps) {
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const send = useEmailSaleReceipt();
  const trimmed = email.trim();

  function submit() {
    const parsed = emailSaleReceiptSchema.safeParse({ email: trimmed });
    if (!parsed.success) {
      setFieldError("Enter a valid email address, like name@example.com.");
      return;
    }

    setFieldError(null);
    send.mutate({ saleId, email: trimmed });
  }

  const sent = send.data;

  return (
    <Modal
      open
      onClose={onClose}
      title={sent ? "Receipt sent" : "Email this receipt"}
      description={
        sent
          ? `${receiptLabel} is on its way to ${sent.to}.`
          : `A copy of ${receiptLabel.toLowerCase()} goes to the address below.`
      }
      size="sm"
      footer={
        sent ? (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={send.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button loading={send.isPending} onClick={submit}>
              <Mail aria-hidden />
              Send receipt
            </Button>
          </div>
        )
      }
    >
      {sent ? (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success-text">
          Sent to {sent.to}. If it does not arrive, check the address and send it again.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {send.isError ? (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {getErrorMessage(send.error)}
            </p>
          ) : null}

          <Input
            label="Send to"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            maxLength={255}
            disabled={send.isPending}
            error={fieldError ?? undefined}
            hint="The receipt shows the same lines and the same GST number as the one on screen."
            autoFocus
            onChange={(event) => {
              setEmail(event.target.value);
              if (fieldError) setFieldError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </div>
      )}
    </Modal>
  );
}
