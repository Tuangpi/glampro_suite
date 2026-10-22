import { useState } from "react";
import type {
  TreatmentConsentEvent,
  TreatmentConsentForm,
  TreatmentConsentState,
} from "@glampro_suite/shared";
import { useAuth } from "@/contexts/AuthContext";
import { useRecordConsentEvent } from "@/hooks/useTreatments";
import { getErrorMessage } from "@/lib/api";
import Button from "@/components/ui/Button";
import ConsentSignature from "./ConsentSignature";

export default function ConsentHistoryActions({
  events,
  states,
  forms,
  customerId,
  recordId,
  blocked,
}: {
  events: TreatmentConsentEvent[];
  states: TreatmentConsentState[];
  forms: TreatmentConsentForm[];
  customerId: string;
  recordId: string;
  blocked: boolean;
}) {
  const { isReadOnly, user } = useAuth();
  const mutation = useRecordConsentEvent();
  const [draft, setDraft] = useState<{
    eventType: "WITHDRAWAL" | "RECONSENT" | "CORRECTION";
    original: TreatmentConsentEvent;
    head: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedHead, setSavedHead] = useState<string | null>(null);
  const manager = user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER";
  const disabled = blocked || isReadOnly || mutation.isPending;
  const head =
    draft &&
    states.find((state) => state.treatmentConsentFormId === draft.original.treatmentConsentFormId);
  const form = draft && forms.find((row) => row.id === draft.original.treatmentConsentFormId);
  const eligible =
    draft &&
    head?.headEventId === draft.head &&
    savedHead !== draft.head &&
    (draft.eventType !== "CORRECTION" || manager) &&
    (draft.eventType !== "RECONSENT" || (form?.isActive && !!draft.original.treatmentConsentForm));
  function open(
    eventType: "WITHDRAWAL" | "RECONSENT" | "CORRECTION",
    original: TreatmentConsentEvent,
    headId: string,
  ) {
    setDraft({ eventType, original, head: headId });
    setReason("");
    setSignature(null);
    setError(null);
  }
  async function save() {
    if (
      !draft ||
      disabled ||
      !eligible ||
      (draft.eventType === "CORRECTION" && !reason.trim()) ||
      (draft.eventType === "RECONSENT" && form?.signatureRequired && !signature)
    )
      return;
    try {
      await mutation.mutateAsync({
        customerId,
        treatmentRecordId: recordId,
        treatmentConsentFormId: draft.original.treatmentConsentFormId,
        previousEventId: draft.head,
        eventType: draft.eventType,
        consented:
          draft.eventType === "CORRECTION"
            ? (head?.consented ?? false)
            : draft.eventType === "RECONSENT",
        ...(draft.eventType === "CORRECTION"
          ? { correctsEventId: draft.original.id, reason: reason.trim() }
          : {}),
        ...(signature && draft.eventType === "RECONSENT" ? { signatureData: signature } : {}),
      });
      setSavedHead(draft.head);
      setDraft(null);
      setError(null);
    } catch (error) {
      setError(getErrorMessage(error));
    }
  }
  return (
    <section aria-label="Consent history actions" className="flex flex-col gap-3">
      {events.map((event, index) => {
        const latest = states.find(
          (row) => row.treatmentConsentFormId === event.treatmentConsentFormId,
        );
        const decision = latest;
        return (
          <div key={event.id}>
            {events.findIndex(
              (row) => row.treatmentConsentFormId === event.treatmentConsentFormId,
            ) === index && decision ? (
              <Button
                disabled={
                  disabled ||
                  savedHead === latest!.headEventId ||
                  (!decision.consented &&
                    !forms.some(
                      (form) => form.id === event.treatmentConsentFormId && form.isActive,
                    ))
                }
                onClick={() =>
                  open(decision.consented ? "WITHDRAWAL" : "RECONSENT", event, latest!.headEventId)
                }
              >
                {decision.consented ? "Withdraw consent" : "Record re-consent"} —{" "}
                {event.treatmentConsentForm?.title ?? event.treatmentConsentFormId}
              </Button>
            ) : null}
            {manager && !isReadOnly ? (
              <Button
                variant="secondary"
                disabled={disabled || !latest || savedHead === latest.headEventId}
                onClick={() => latest && open("CORRECTION", event, latest.headEventId)}
              >
                Annotate evidence {event.id}
              </Button>
            ) : null}
          </div>
        );
      })}
      {draft && eligible && !isReadOnly ? (
        <section aria-label="Confirm consent history event">
          <p>
            {draft.eventType} — {draft.original.treatmentConsentForm?.title}, version{" "}
            {draft.original.treatmentConsentForm?.version}. Original evidence is preserved.
            Corrections are annotations only and do not change consent.
          </p>
          {draft.eventType === "CORRECTION" ? (
            <label>
              Correction reason
              <textarea
                value={reason}
                maxLength={2000}
                disabled={disabled}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          ) : null}
          {draft.eventType === "RECONSENT" ? (
            <>
              <p className="whitespace-pre-wrap">{draft.original.treatmentConsentForm?.content}</p>
              {form?.signatureRequired ? (
                <ConsentSignature key={draft.head} disabled={disabled} onChange={setSignature} />
              ) : null}
            </>
          ) : null}
          <Button
            disabled={
              disabled ||
              (draft.eventType === "CORRECTION" && !reason.trim()) ||
              (draft.eventType === "RECONSENT" && !!form?.signatureRequired && !signature)
            }
            onClick={() => void save()}
          >
            Confirm {draft.eventType.toLowerCase()}
          </Button>
          <Button disabled={mutation.isPending} variant="secondary" onClick={() => setDraft(null)}>
            Cancel history event
          </Button>
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
