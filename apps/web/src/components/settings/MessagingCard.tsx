import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { messagingSettingsSchema, type MessagingSettingsInput } from "@glampro_suite/shared";
import { get, put, post, getErrorMessage } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Checkbox from "@/components/ui/Checkbox";
import { useAuth } from "@/contexts/AuthContext";

export default function MessagingCard({ canEdit }: { canEdit: boolean }) {
  const { tenant } = useAuth();
  const [showHistory, setShowHistory] = useState(false);
  const [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: ["messaging-settings", tenant?.id],
    queryFn: () => get<MessagingSettingsInput>("/messaging/settings"),
  });
  return (
    <Card
      title="WhatsApp and SMS"
      description="Disabled until sender configuration and channel consent are ready. No automatic fallback."
    >
      {query.isPending ? (
        <p>Loading messaging settings…</p>
      ) : query.isError ? (
        <p role="alert">Messaging settings could not be loaded.</p>
      ) : query.data ? (
        <SettingsEditor
          key={JSON.stringify(query.data)}
          data={query.data}
          canEdit={canEdit}
          onSaved={setSaved}
        />
      ) : null}
      {saved ? (
        <p role="status" className="mt-3 text-sm">
          Messaging settings saved.
        </p>
      ) : null}
      {canEdit && (
        <details
          className="mt-5 rounded-lg border border-line p-3"
          onToggle={(event) => setShowHistory(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-sm font-medium text-ink">
            View delivery history
          </summary>
          {showHistory && <MessageHistory canEdit={canEdit} />}
        </details>
      )}
    </Card>
  );
}
function SettingsEditor({
  data,
  canEdit,
  onSaved,
}: {
  data: MessagingSettingsInput;
  canEdit: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(data);
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (value: MessagingSettingsInput) => put("/messaging/settings", value),
    onSuccess: () => client.invalidateQueries({ queryKey: ["messaging-settings"] }),
  });
  return (
    <form
      className="flex flex-col gap-3"
      onChange={() => onSaved(false)}
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        onSaved(false);
        const parsed = messagingSettingsSchema.safeParse(draft);
        if (!parsed.success) {
          setError(parsed.error.issues.map((v) => v.message).join(" "));
          return;
        }
        mutation.mutate(parsed.data, {
          onError: (cause) => setError(getErrorMessage(cause)),
          onSuccess: () => onSaved(true),
        });
      }}
    >
      <fieldset disabled={!canEdit || mutation.isPending} className="flex flex-col gap-3">
        <Checkbox
          label="Enable WhatsApp"
          checked={draft.whatsappEnabled}
          onChange={(e) => setDraft({ ...draft, whatsappEnabled: e.target.checked })}
        />
        <Checkbox
          label="Enable SMS"
          checked={draft.smsEnabled}
          onChange={(e) => setDraft({ ...draft, smsEnabled: e.target.checked })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["reminderHours", "Reminder lead time (hours)"],
              ["rebookingDays", "Rebooking delay (days)"],
              ["quietStart", "Quiet hours start (0–23)"],
              ["quietEnd", "Quiet hours end (0–23)"],
              ["cancellationHours", "Self-cancellation cutoff (hours)"],
            ] as const
          ).map(([key, label]) => (
            <Input
              key={key}
              label={label}
              type="number"
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
            />
          ))}
        </div>
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            Channel consent wording
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <Input
              label="Channel notice version"
              value={draft.consentVersion}
              onChange={(e) => setDraft({ ...draft, consentVersion: e.target.value })}
            />
            <label className="flex flex-col gap-1 text-sm">
              Appointment/receipt channel consent wording
              <textarea
                className="min-h-28 w-full rounded-md border border-line bg-surface p-3"
                value={draft.serviceConsentText}
                onChange={(e) => setDraft({ ...draft, serviceConsentText: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Optional channel marketing wording
              <textarea
                className="min-h-28 w-full rounded-md border border-line bg-surface p-3"
                value={draft.marketingConsentText}
                onChange={(e) => setDraft({ ...draft, marketingConsentText: e.target.value })}
              />
            </label>
          </div>
        </details>
        <div className="flex justify-end">
          <Button type="submit" loading={mutation.isPending}>
            Save messaging settings
          </Button>
        </div>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
interface History {
  rows: {
    id: string;
    kind: string;
    channel: string | null;
    status: string;
    attempts: number;
    errorCode: string | null;
  }[];
  total: number;
}
function MessageHistory({ canEdit }: { canEdit: boolean }) {
  const { tenant } = useAuth();
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["message-history", tenant?.id, page],
    queryFn: () => get<History>(`/messaging/history?page=${page}`),
    enabled: canEdit,
  });
  const retry = useMutation({
    mutationFn: (id: string) => post(`/messaging/history/${id}/retry`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["message-history"] }),
    onError: (cause) => setError(getErrorMessage(cause)),
  });
  if (!canEdit) return null;
  return (
    <section className="mt-4">
      <h3>Message delivery history</h3>
      {error ? <p role="alert">{error}</p> : null}
      {query.isError ? <p role="alert">History could not be loaded.</p> : null}
      <ul>
        {query.data?.rows.map((row) => (
          <li key={row.id} className="border-b py-2">
            {row.kind} · {row.channel ?? "Customer preference"} · {row.status} · attempts{" "}
            {row.attempts}
            {row.errorCode ? ` · ${row.errorCode}` : ""}
            {row.status === "FAILED" ? (
              <Button type="button" disabled={retry.isPending} onClick={() => retry.mutate(row.id)}>
                Retry failed message
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        disabled={page === 1 || query.isFetching}
        onClick={() => setPage(page - 1)}
      >
        Previous messages
      </Button>
      <Button
        type="button"
        disabled={!query.data || page * 20 >= query.data.total || query.isFetching}
        onClick={() => setPage(page + 1)}
      >
        Next messages
      </Button>
      <Button type="button" onClick={() => void query.refetch()}>
        Refresh messages
      </Button>
    </section>
  );
}
