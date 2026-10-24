import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assistantDraftSchema,
  assistantOutcomeSchema,
  type AssistantDraft,
} from "@glampro_suite/shared";
import { get, post, patch } from "@/lib/api";
import Button from "@/components/ui/Button";

import { draftKey } from "./assistant-draft-keys";

export default function AssistantDraftReview({
  tenantId,
  userId,
}: {
  tenantId: string;
  userId: string;
}) {
  const [cursor, setCursor] = useState<string>();
  const query = useQuery({
    queryKey: [...draftKey, tenantId, userId, cursor],
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const result = await get<{ drafts: unknown[]; nextCursor: string | null }>(
        "/ai-assistant/drafts",
        cursor ? { cursor } : undefined,
      );
      return {
        drafts: assistantDraftSchema.array().parse(result.drafts),
        nextCursor: result.nextCursor,
      };
    },
  });
  return (
    <section className="mt-4 rounded-md border border-line p-4" aria-label="Saved draft review">
      <h3 className="font-bold">Saved drafts and delivery review</h3>
      <p>
        SMS only. WhatsApp and promotions are gated. Maximum 20 queued per company per salon-local
        day. Retention review due after 30 days; no automatic deletion.
      </p>
      <Button variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}>
        Reload saved drafts
      </Button>
      {query.isFetching ? (
        <p role="status">Loading saved drafts…</p>
      ) : query.isError ? (
        <p role="status">Saved drafts unavailable. Reload to retry.</p>
      ) : (
        <>
          {query.data?.drafts.length === 0 && <p>No saved drafts.</p>}
          {query.data?.drafts.map((draft) => (
            <Review
              key={`${draft.id}:${draft.version}:${draft.status}:${query.dataUpdatedAt}`}
              draft={draft}
              tenantId={tenantId}
              userId={userId}
            />
          ))}
          {cursor && <Button onClick={() => setCursor(undefined)}>First page</Button>}
          {query.data?.nextCursor && (
            <Button onClick={() => setCursor(query.data!.nextCursor!)}>Next page</Button>
          )}
        </>
      )}
    </section>
  );
}

function Review({
  draft,
  tenantId,
  userId,
}: {
  draft: AssistantDraft;
  tenantId: string;
  userId: string;
}) {
  const client = useQueryClient();
  const [message, setMessage] = useState(draft.message);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  async function reviewRetention() {
    setBusy(true);
    setError("");
    try {
      await post(`/ai-assistant/drafts/${draft.id}/retention-review`, {
        expectedVersion: draft.version,
        reason,
      });
      await client.invalidateQueries({ queryKey: draftKey });
    } catch {
      setError("Retention review failed. Reload before retrying.");
    } finally {
      setBusy(false);
    }
  }
  async function act(action: "edit" | "approve" | "queue") {
    setBusy(true);
    setError("");
    try {
      if (action === "edit")
        await patch(`/ai-assistant/drafts/${draft.id}`, {
          customerId: draft.customerId,
          appointmentId: draft.appointmentId,
          channel: draft.channel,
          destination: draft.destination,
          message,
          expectedVersion: draft.version,
        });
      else
        await post(`/ai-assistant/drafts/${draft.id}/${action}`, {
          expectedVersion: draft.version,
        });
      await client.invalidateQueries({ queryKey: draftKey });
    } catch {
      setError(
        "Action failed. Reload and review current eligibility/version before retrying. Nothing is confirmed sent.",
      );
    } finally {
      setBusy(false);
    }
  }
  const dirty = message !== draft.message;
  return (
    <article className="mt-4 rounded-md border border-line p-4">
      <p>
        Version {draft.version} · {draft.status} · {draft.channel} · {draft.destination}
      </p>
      <p>
        Sender: {draft.sender} · Retention review due: {draft.reviewDueAt}
      </p>
      <p>Exact SMS body for this saved version (including unsubscribe link):</p>
      <pre className="whitespace-pre-wrap break-all">{draft.body}</pre>
      {draft.status !== "QUEUED" && (
        <>
          <label className="flex flex-col">
            Edit saved message
            <textarea
              value={message}
              maxLength={1000}
              onChange={(e) => setMessage(e.target.value)}
              disabled={busy}
            />
          </label>
          <Button disabled={busy || !dirty || !message.trim()} onClick={() => void act("edit")}>
            Save new version (invalidates approval)
          </Button>
          {dirty && (
            <p>Save edits and review the new exact SMS body before approval or queueing.</p>
          )}
          {draft.status === "DRAFT" && (
            <Button disabled={busy || dirty} onClick={() => void act("approve")}>
              Approve version {draft.version}
            </Button>
          )}
          {draft.status === "APPROVED" && (
            <Button disabled={busy || dirty} onClick={() => void act("queue")}>
              Queue approved SMS to {draft.destination}
            </Button>
          )}
        </>
      )}
      {draft.job && (
        <p>
          Queue outcome: {draft.job.status} {draft.job.errorCode ?? ""}. Queued/accepted is not
          proof of delivery. Uncertain messages must not be blindly resent.
        </p>
      )}
      <Button variant="secondary" onClick={() => setOutcomeOpen((value) => !value)}>
        Toggle observed outcomes
      </Button>
      {outcomeOpen && <Outcome id={draft.id} tenantId={tenantId} userId={userId} />}
      <label className="flex flex-col">
        Reason for continued retention (manual review)
        <input
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </label>
      <Button disabled={busy || reason.trim().length < 3} onClick={() => void reviewRetention()}>
        Record retention review
      </Button>
      <p>
        Records reviewer, reason and next review in 30 days. Unqueued approvals are invalidated.
        This does not erase records or authorize delivery.
      </p>
      <Button variant="secondary" onClick={() => setHistoryOpen((value) => !value)}>
        Toggle version audit history
      </Button>
      {historyOpen && <History id={draft.id} />}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

function Outcome({ id, tenantId, userId }: { id: string; tenantId: string; userId: string }) {
  const query = useQuery({
    queryKey: [...draftKey, tenantId, userId, "outcome", id],
    retry: false,
    staleTime: 0,
    queryFn: async () =>
      assistantOutcomeSchema.parse(await get<unknown>(`/ai-assistant/drafts/${id}/outcome`)),
  });
  return (
    <section aria-label="Observed outcomes">
      <Button onClick={() => void query.refetch()} disabled={query.isFetching}>
        Reload observed outcomes
      </Button>
      {query.isFetching ? (
        <p role="status">Loading observed outcomes…</p>
      ) : query.isError ? (
        <p role="status">
          Observed outcomes unavailable. Reload to retry; no results are confirmed.
        </p>
      ) : query.data ? (
        <>
          <p>
            {query.data.delivery === "provider_reported_delivered"
              ? "Provider-reported delivery, not proof of reading or action."
              : query.data.delivery === "not_queued"
                ? "Not queued; no observation window."
                : "Delivery not confirmed."}
          </p>
          <p>As of: {query.data.asOf}</p>
          {query.data.from && (
            <>
              <p>
                UTC observation window: [{query.data.from}, {query.data.to}) · at most 30 elapsed
                days.
              </p>
              <p>Bookings created (not currently cancelled): {query.data.bookingsCreated}</p>
              <p>
                Completed receipts:{" "}
                {query.data.salesVisible ? query.data.completedSales : "Sales module required"}
              </p>
            </>
          )}
          <ul>
            {query.data.limitations.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function History({ id }: { id: string }) {
  const [cursor, setCursor] = useState<string>();
  const query = useQuery({
    queryKey: [...draftKey, "history", id, cursor],
    retry: false,
    queryFn: () =>
      get<{
        events: Array<{
          id: string;
          action: string;
          version: number;
          actorId: string;
          createdAt: string;
          snapshot: unknown;
        }>;
        nextCursor: string | null;
      }>(`/ai-assistant/drafts/${id}/history`, cursor ? { cursor } : undefined),
  });
  return (
    <div aria-label="Version audit history">
      {query.isFetching ? (
        <p>Loading audit history…</p>
      ) : query.isError ? (
        <p>Audit history unavailable.</p>
      ) : (
        <>
          {query.data?.events.map((event) => (
            <details key={event.id}>
              <summary>
                {event.action} · version {event.version} · {event.actorId} · {event.createdAt}
              </summary>
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(event.snapshot, null, 2)}
              </pre>
            </details>
          ))}
          {cursor && <Button onClick={() => setCursor(undefined)}>Newest audit events</Button>}
          {query.data?.nextCursor && (
            <Button onClick={() => setCursor(query.data!.nextCursor!)}>Older audit events</Button>
          )}
        </>
      )}
    </div>
  );
}
