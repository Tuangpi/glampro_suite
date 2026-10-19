import { useState } from "react";
import type { CustomerConsent } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import { useCustomerConsent, useRecordCustomerConsent } from "@/hooks/useConsent";
import { useAuth } from "@/contexts/AuthContext";
import { getErrorMessage } from "@/lib/api";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

export default function CustomerConsentPanel({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const query = useCustomerConsent(customerId, page);
  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-line p-3"
      aria-label="Customer consent"
    >
      <h3 className="font-bold">Privacy and marketing choices</h3>
      {query.isPending ? (
        <p>Loading consent…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>Consent could not be loaded.</p>
          <Button type="button" onClick={() => void query.refetch()}>
            Retry consent
          </Button>
        </div>
      ) : query.data ? (
        <ConsentEditor
          key={`${customerId}-${query.data.revision}-${query.data.currentNotice?.id}`}
          customerId={customerId}
          data={query.data}
        />
      ) : null}
      <Button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
        Reload consent
      </Button>
      {query.data && query.data.total > 10 ? (
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={page === 1 || query.isFetching}
            onClick={() => setPage(page - 1)}
          >
            Previous history
          </Button>
          <Button
            type="button"
            disabled={page * 10 >= query.data.total || query.isFetching}
            onClick={() => setPage(page + 1)}
          >
            Next history
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ConsentEditor({ customerId, data }: { customerId: string; data: CustomerConsent }) {
  const { isReadOnly } = useAuth();
  const { formatDate } = useSalonFormatting();
  const mutation = useRecordCustomerConsent(customerId);
  const [pdpa, setPdpa] = useState(data.pdpaConsent);
  const [marketing, setMarketing] = useState(data.marketingOptIn);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const notice = data.currentNotice;
  const granting = (!data.pdpaConsent && pdpa) || (!data.marketingOptIn && marketing);
  const disabled = isReadOnly || mutation.isPending;
  async function save() {
    setError(null);
    setSaved(false);
    try {
      await mutation.mutateAsync({
        pdpaConsent: pdpa,
        marketingOptIn: marketing,
        expectedRevision: data.revision,
        noticeId: notice?.id ?? null,
      });
      setSaved(true);
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }
  return (
    <>
      {notice ? (
        <div className="space-y-2 text-sm">
          <p className="font-bold">Notice version: {notice.version}</p>
          <p className="whitespace-pre-wrap">{notice.dataConsentText}</p>
          <p className="whitespace-pre-wrap">{notice.marketingConsentText}</p>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          Consent capture is disabled until a manager publishes a privacy notice in Settings.
          Existing choices can still be withdrawn.
        </p>
      )}
      <Checkbox
        label="Personal-data consent granted"
        checked={pdpa}
        disabled={disabled || (!notice && !pdpa)}
        onChange={(event) => {
          setPdpa(event.target.checked);
          if (!event.target.checked) setMarketing(false);
        }}
      />
      <Checkbox
        label="Optional marketing opt-in"
        checked={marketing}
        disabled={disabled || !pdpa || (!notice && !marketing)}
        onChange={(event) => setMarketing(event.target.checked)}
        hint="Do not select without the customer's explicit choice. Receipts do not require marketing opt-in."
      />
      {granting ? (
        <Checkbox
          label="I presented this notice and recorded the customer's choices"
          checked={reviewed}
          disabled={disabled}
          onChange={(event) => setReviewed(event.target.checked)}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {saved ? <p role="status">Consent choices saved.</p> : null}
      <Button
        type="button"
        onClick={() => void save()}
        disabled={
          disabled ||
          (pdpa === data.pdpaConsent && marketing === data.marketingOptIn) ||
          (granting && (!notice || !reviewed))
        }
      >
        Save consent choices
      </Button>
      <p className="text-xs text-ink-muted">
        Consent is saved separately from customer details. Withdrawing personal-data consent also
        withdraws marketing opt-in.
      </p>
      <h4 className="font-bold text-sm">Consent history</h4>
      {data.history.length === 0 ? (
        <p className="text-sm">No consent has been recorded.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {data.history.map((event) => (
            <li key={event.id}>
              <p>
                {formatDate(event.recordedAt)} · Personal data:{" "}
                {event.pdpaConsent ? "Granted" : "Not granted / withdrawn"} · Marketing:{" "}
                {event.marketingOptIn ? "Opted in" : "Not opted in / withdrawn"}
              </p>
              <p className="text-xs text-ink-muted">Recorded by staff {event.recordedById}</p>
              {event.notice ? (
                <details>
                  <summary>Notice {event.notice.version}</summary>
                  <p className="whitespace-pre-wrap">{event.notice.dataConsentText}</p>
                  <p className="whitespace-pre-wrap">{event.notice.marketingConsentText}</p>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
