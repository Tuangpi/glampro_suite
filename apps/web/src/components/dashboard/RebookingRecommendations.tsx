import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rebookingNudgeSchema, type RebookingNudge } from "@glampro_suite/shared";
import { useAuth } from "@/contexts/AuthContext";
import { queryKeys } from "@/constants/queryKeys";
import { get } from "@/lib/api";
import Button from "@/components/ui/Button";

export default function RebookingRecommendations() {
  const { user, tenant, entitlements } = useAuth();
  if (
    !user ||
    !tenant ||
    !["SUPER_ADMIN", "MANAGER"].includes(user.globalRole) ||
    !["dashboard", "customers", "appointments"].every((code) =>
      entitlements?.some((entry) => entry.code === code),
    )
  )
    return null;
  return <Workspace key={`${tenant.id}:${user.id}`} tenantId={tenant.id} userId={user.id} />;
}

function Workspace({ tenantId, userId }: { tenantId: string; userId: string }) {
  const query = useQuery({
    queryKey: queryKeys.ownerAssistant.rebooking(tenantId, userId),
    queryFn: async () =>
      rebookingNudgeSchema.array().parse(await get<unknown>("/ai-assistant/rebooking-nudges")),
    staleTime: 0,
    retry: false,
  });
  return (
    <section
      aria-labelledby="rebooking-title"
      className="rounded-card border border-line bg-surface p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="rebooking-title" className="text-xl">
          Rebooking recommendations
        </h2>
        <Button
          variant="secondary"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh recommendations
        </Button>
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        Temporary editable drafts only. Nothing is saved, approved or sent. Refreshing discards
        edits. Dates are salon-local. Tomorrow is a suggested date, not checked availability.
      </p>
      {query.isFetching ? (
        <p role="status">Checking current consent, bookings and message jobs…</p>
      ) : query.isError ? (
        <p role="status">
          Recommendations unavailable. Refresh to retry; previous drafts are hidden.
        </p>
      ) : query.data?.length === 0 ? (
        <p role="status">
          No eligible recommendations. Disabled channels, consent, upcoming bookings and existing
          outreach can exclude customers.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {query.data?.map((nudge) => (
            <Draft key={`${nudge.draftId}:${query.dataUpdatedAt}`} nudge={nudge} />
          ))}
        </div>
      )}
    </section>
  );
}

function Draft({ nudge }: { nudge: RebookingNudge }) {
  const [message, setMessage] = useState(nudge.message);
  return (
    <article className="rounded-md border border-line p-4">
      <h3 className="font-bold">{nudge.customerName}</h3>
      <p>
        {nudge.serviceName} · last visit {nudge.lastServiceDate} · {nudge.daysSinceLastService} days
        ago
      </p>
      <p>
        {nudge.serviceInterval}-day interval ({nudge.intervalSource}); suggested date{" "}
        {nudge.suggestedRebookDate}
      </p>
      <p>
        {nudge.channel} · {nudge.destination} · current preferred marketing permission
      </p>
      <label className="mt-3 flex flex-col gap-1">
        Draft for {nudge.customerName}
        <textarea
          className="rounded-md border border-line p-2"
          value={message}
          maxLength={2000}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      <p className="text-sm text-ink-muted">
        Eligibility is a point-in-time preview. Consent and contact limits must be rechecked before
        any future approval or delivery.
      </p>
    </article>
  );
}
