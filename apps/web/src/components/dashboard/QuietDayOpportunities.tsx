import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { quietDayResponseSchema } from "@glampro_suite/shared";
import { useAuth } from "@/contexts/AuthContext";
import { useServiceList } from "@/hooks/useServices";
import { queryKeys } from "@/constants/queryKeys";
import { get } from "@/lib/api";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";

export default function QuietDayOpportunities() {
  const { user, tenant, entitlements } = useAuth();
  if (
    !user ||
    !tenant ||
    !["SUPER_ADMIN", "MANAGER"].includes(user.globalRole) ||
    !["dashboard", "appointments", "catalogue"].every((code) =>
      entitlements?.some((entry) => entry.code === code),
    )
  )
    return null;
  return <Workspace key={`${tenant.id}:${user.id}`} tenantId={tenant.id} userId={user.id} />;
}

function Workspace({ tenantId, userId }: { tenantId: string; userId: string }) {
  const [serviceId, setServiceId] = useState("");
  const [page, setPage] = useState(1);
  const services = useServiceList({ page, pageSize: 25, status: "ACTIVE" });
  const query = useQuery({
    queryKey: queryKeys.ownerAssistant.quietDays(tenantId, userId, serviceId),
    queryFn: async () =>
      quietDayResponseSchema.parse(
        await get<unknown>("/ai-assistant/quiet-day-opportunities", { serviceId }),
      ),
    enabled: serviceId !== "",
    retry: false,
    staleTime: 0,
  });
  const facts = query.isError || query.isFetching ? undefined : query.data;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: facts?.timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  return (
    <section
      aria-labelledby="quiet-days-title"
      className="rounded-card border border-line bg-surface p-4 sm:p-6"
    >
      <h2 id="quiet-days-title" className="text-lg">
        Future quiet-day opportunities
      </h2>
      <p className="my-2 text-sm text-ink-muted">
        Review regular-price openings first. This preview does not create offers, select recipients,
        reserve appointments or send messages.
      </p>
      {services.isError ? (
        <p role="status">
          Services unavailable.{" "}
          <Button variant="secondary" onClick={() => void services.refetch()}>
            Retry services
          </Button>
        </p>
      ) : (
        <>
          <Select
            label="Service for opening checks"
            value={serviceId}
            options={(services.data?.data ?? []).map((service) => ({
              value: service.id,
              label: service.name,
            }))}
            disabled={services.isFetching}
            onChange={(event) => setServiceId(event.target.value)}
          />
          <div className="my-3 flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={page === 1 || services.isFetching}
              onClick={() => {
                setServiceId("");
                setPage(page - 1);
              }}
            >
              Previous services
            </Button>
            <span>Service page {page}</span>
            <Button
              variant="secondary"
              disabled={services.isFetching || !services.data || page * 25 >= services.data.total}
              onClick={() => {
                setServiceId("");
                setPage(page + 1);
              }}
            >
              Next services
            </Button>
          </div>
        </>
      )}
      <Button
        variant="secondary"
        disabled={!serviceId || query.isFetching}
        onClick={() => void query.refetch()}
      >
        Refresh opening checks
      </Button>
      {!serviceId ? (
        <p>Select a service to check tomorrow through the next seven salon-local days.</p>
      ) : query.isFetching ? (
        <p role="status">Checking configured hours, staff and resources…</p>
      ) : query.isError ? (
        <p role="status">
          Opening checks unavailable. Refresh to retry; previous suggestions are hidden.
        </p>
      ) : facts ? (
        <div className="mt-4 flex flex-col gap-3">
          <p>
            {facts.serviceName} · {facts.durationMinutes} minutes · {facts.timeZone}
          </p>
          <p>
            Checked {stamp(facts.asOf)}. Window [{facts.from}, {facts.to}).
          </p>
          <p>
            {facts.checkedSlots} staff/slot checks.{" "}
            {facts.searchLimited
              ? "Search limit reached; results are partial."
              : "Bounded search; not a complete capacity audit."}
          </p>
          {facts.opportunities.length === 0 ? (
            <p role="status">
              No verified openings found within this search. This does not mean every day is full.
            </p>
          ) : (
            facts.opportunities.map((opening) => (
              <article key={opening.startsAt} className="rounded-md border border-line p-3">
                <h3 className="font-bold">
                  {stamp(opening.startsAt)} – {stamp(opening.endsAt)}
                </h3>
                <p>
                  {opening.bookingCount} non-cancelled booking starts that day; below the screening
                  threshold of {facts.lowBookingThreshold}.
                </p>
                <p>{opening.action}</p>
              </article>
            ))
          )}
          <h3 className="font-bold">Evidence and limitations</h3>
          <ul className="list-disc pl-5">
            {facts.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
