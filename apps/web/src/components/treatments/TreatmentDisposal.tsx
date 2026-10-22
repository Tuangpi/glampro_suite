import { useEffect, useState } from "react";
import type { TreatmentDisposalPreview, TreatmentDisposalReceipt } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewTreatmentDisposal, useDisposeTreatment } from "@/hooks/useTreatments";
import { getErrorMessage } from "@/lib/api";

export default function TreatmentDisposal({
  recordId,
  customerId,
  blocked,
  onDisposed,
}: {
  recordId: string;
  customerId: string;
  blocked: boolean;
  onDisposed?: (receipt: TreatmentDisposalReceipt) => void;
}) {
  const { user, isReadOnly } = useAuth();
  const previewMutation = usePreviewTreatmentDisposal();
  const disposal = useDisposeTreatment();
  const [preview, setPreview] = useState<TreatmentDisposalPreview | null>(null);
  const [receipt, setReceipt] = useState<TreatmentDisposalReceipt | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(
      () => setExpired(true),
      Math.min(2_147_483_647, Math.max(0, Date.parse(preview.expiresAt) - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [preview]);
  if (user?.globalRole !== "SUPER_ADMIN" || isReadOnly) return null;
  const busy = blocked || previewMutation.isPending || disposal.isPending;
  async function loadPreview() {
    if (busy) return;
    setError(null);
    setPreview(null);
    setConfirmation("");
    try {
      const result = await previewMutation.mutateAsync(recordId);
      if (result.treatmentRecordId !== recordId || result.customerId !== customerId)
        throw new Error("The preview does not match this customer and treatment.");
      setPreview(result);
      setExpired(Date.now() >= Date.parse(result.expiresAt));
    } catch (error) {
      setError(getErrorMessage(error));
    }
  }
  async function dispose() {
    if (
      busy ||
      !preview ||
      expired ||
      Date.now() >= Date.parse(preview.expiresAt) ||
      confirmation !== "DISPOSE" ||
      !reason.trim()
    )
      return;
    setError(null);
    try {
      const saved = await disposal.mutateAsync({
        id: recordId,
        input: {
          previewToken: preview.previewToken,
          reason: reason.trim(),
          confirmation: "DISPOSE",
        },
      });
      setReceipt(saved);
      onDisposed?.(saved);
      setPreview(null);
      setReason("");
      setConfirmation("");
    } catch (error) {
      setError(getErrorMessage(error));
      setPreview(null);
      setConfirmation("");
    }
  }
  return (
    <section
      aria-label="Owner-authorized treatment disposal"
      className="flex flex-col gap-3 rounded-card border border-line p-3"
    >
      <h4 className="font-bold">Permanently dispose of this treatment</h4>
      <p>
        Only completed or cancelled treatments without a retention hold are eligible. Retention
        review alone does not authorize disposal. No automatic purge or fixed retention period
        applies.
      </p>
      <p>
        This removes the clinical record, its consent events and signatures, and before/after links.
        Original customer photos, customer records, published forms, appointments, POS history and
        package balances are preserved. This is not complete customer-data erasure. Backups and
        exports are not erased.
      </p>
      {receipt ? (
        <p role="status">
          Treatment disposed. Receipt {receipt.receiptId}. Recorded at {receipt.disposedAt}.
        </p>
      ) : (
        <>
          <Button variant="secondary" disabled={busy} onClick={() => void loadPreview()}>
            Preview disposal
          </Button>
          <Input
            label="Disposal reason"
            value={reason}
            maxLength={500}
            disabled={busy}
            hint="State why retention is no longer needed. Do not include clinical or customer details; this reason remains in the audit receipt."
            onChange={(event) => {
              setReason(event.target.value);
              setConfirmation("");
            }}
          />
          {preview ? (
            <>
              <p>
                Will remove 1 treatment, {preview.consentEvents} consent events,{" "}
                {preview.signatures} signatures and {preview.photoLinks} photo links. Preview
                expires at {preview.expiresAt}. This cannot be undone in the application.
              </p>
              <Input
                label="Type DISPOSE to confirm permanent disposal"
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
              <Button
                variant="danger"
                disabled={busy || !reason.trim() || confirmation !== "DISPOSE" || expired}
                onClick={() => void dispose()}
              >
                Permanently dispose treatment
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setConfirmation("");
                }}
              >
                Cancel disposal
              </Button>
            </>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert">{error} Preview again before retrying. Your reason is preserved.</p>
      ) : null}
    </section>
  );
}
