import { useState } from "react";
import { reviewTreatmentRetentionSchema, type TreatmentRecord } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useReviewTreatmentRetention, useTreatment } from "@/hooks/useTreatments";
import { getErrorMessage } from "@/lib/api";
import { instantFromSalonDate, toSalonDate } from "@/lib/salon-time";
import { formatDateInputValue } from "@/lib/utils";

export default function TreatmentRetention({
  customerId,
  recordId,
}: {
  customerId: string;
  recordId: string;
}) {
  const query = useTreatment(recordId);
  const { isReadOnly, user } = useAuth();
  const { formatDateTime, timeZone } = useSalonFormatting();
  if (query.isError)
    return (
      <div role="alert">
        Retention details could not be loaded.{" "}
        <Button onClick={() => void query.refetch()}>Retry retention</Button>
      </div>
    );
  if (query.isPending) return <p role="status">Loading retention details…</p>;
  const record = query.data;
  if (!record || record.id !== recordId || record.customerId !== customerId)
    return <p role="alert">Treatment is unavailable for this customer.</p>;
  const canManage =
    !isReadOnly && (user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER");
  return (
    <section className="flex flex-col gap-4" aria-label="Treatment retention">
      <h3 className="font-bold">{record.treatmentType}</h3>
      <p>
        Manual review does not authorize disposal. No automatic purge or fixed retention period is
        configured. Archival does not replace retention review.
      </p>
      <dl>
        <dt>Retention hold</dt>
        <dd>{record.retentionHold ? "Active" : "Not active"}</dd>
        <dt>Hold reason</dt>
        <dd className="whitespace-pre-wrap break-words">{record.retentionHoldReason ?? "—"}</dd>
        <dt>Next review</dt>
        <dd>
          {record.retentionReviewAt ? formatDateTime(record.retentionReviewAt) : "Not scheduled"}
        </dd>
        <dt>Retention reason</dt>
        <dd className="whitespace-pre-wrap break-words">{record.retentionReason ?? "—"}</dd>
        <dt>Last reviewed</dt>
        <dd>
          {record.retentionReviewedAt ? formatDateTime(record.retentionReviewedAt) : "Not reviewed"}
        </dd>
        <dt>Reviewer account</dt>
        <dd>{record.retentionReviewedById ?? "—"}</dd>
      </dl>
      {canManage ? (
        <RetentionEditor
          key={`${record.id}:${record.updatedAt}:${timeZone}`}
          record={record}
          refreshing={query.isFetching}
        />
      ) : (
        <p>Only owners and managers in a writable salon can change retention reviews and holds.</p>
      )}
    </section>
  );
}

function RetentionEditor({ record, refreshing }: { record: TreatmentRecord; refreshing: boolean }) {
  const { timeZone } = useSalonFormatting();
  const { isReadOnly, user } = useAuth();
  const mutation = useReviewTreatmentRetention();
  const local = record.retentionReviewAt ? toSalonDate(record.retentionReviewAt, timeZone) : null;
  const initialDate = local
    ? `${formatDateInputValue(local)}T${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`
    : "";
  const [reviewAt, setReviewAt] = useState(initialDate);
  const [reason, setReason] = useState(record.retentionReason ?? "");
  const [hold, setHold] = useState(record.retentionHold ?? false);
  const [holdReason, setHoldReason] = useState(record.retentionHoldReason ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const canManage =
    !isReadOnly && (user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER");
  const busy = mutation.isPending || refreshing;
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || busy || !confirmed || saved) return;
    setError(null);
    try {
      const date = new Date(reviewAt);
      if (Number.isNaN(date.getTime())) throw new Error("Choose a valid review date and time.");
      // Preserve seconds/milliseconds when the displayed schedule is unchanged.
      const instant =
        reviewAt === initialDate && record.retentionReviewAt
          ? record.retentionReviewAt
          : instantFromSalonDate(date, timeZone).toISOString();
      const parsed = reviewTreatmentRetentionSchema.safeParse({
        reviewAt: instant,
        reason,
        hold,
        holdReason: hold ? holdReason : null,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Check the review details.");
        return;
      }
      await mutation.mutateAsync({ id: record.id, input: parsed.data });
      setSaved(true);
    } catch (error) {
      setError(getErrorMessage(error));
    }
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => void save(event)}
      onChange={() => {
        setConfirmed(false);
        setSaved(false);
      }}
    >
      <Input
        label={`Next review (${timeZone})`}
        type="datetime-local"
        required
        value={reviewAt}
        disabled={busy}
        onChange={(event) => setReviewAt(event.target.value)}
      />
      <Input
        label="Reason for continued retention"
        required
        maxLength={2000}
        value={reason}
        disabled={busy}
        onChange={(event) => setReason(event.target.value)}
      />
      <label>
        <input
          type="checkbox"
          checked={hold}
          disabled={busy}
          onChange={(event) => setHold(event.target.checked)}
        />{" "}
        Retention hold
      </label>
      {hold ? (
        <Input
          label="Retention hold reason"
          required
          maxLength={2000}
          value={holdReason}
          disabled={busy}
          onChange={(event) => setHoldReason(event.target.value)}
        />
      ) : null}
      {record.retentionHold && !hold ? (
        <p role="alert">
          Saving will release the existing hold. Consent evidence remains protected. Document the
          release in the retention reason.
        </p>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        disabled={busy || saved}
        onClick={() => setConfirmed(true)}
      >
        Review changes
      </Button>
      {confirmed ? (
        <div>
          <p>
            Confirm this review and{" "}
            {hold ? "keep or place a retention hold" : "leave no active retention hold"}. Your
            authenticated account and the review time will be recorded.
          </p>
          <Button type="submit" disabled={busy || !canManage || saved}>
            Confirm retention review
          </Button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {saved ? <p role="status">Retention review saved.</p> : null}
    </form>
  );
}
