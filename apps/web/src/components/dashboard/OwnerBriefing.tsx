import { useState } from "react";
import { Link } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useOwnerBriefing } from "@/hooks/useOwnerBriefing";
import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";

/** Unmount on identity/role/module loss: do not expose a former owner's cached facts. */
export default function OwnerBriefing() {
  const { user, tenant, entitlements } = useAuth();
  if (
    !user ||
    !tenant ||
    !["SUPER_ADMIN", "MANAGER"].includes(user.globalRole) ||
    !entitlements.some((entry) => entry.code === "dashboard")
  )
    return null;
  return <Briefing key={`${tenant.id}:${user.id}`} tenantId={tenant.id} userId={user.id} />;
}

function Briefing({ tenantId, userId }: { tenantId: string; userId: string }) {
  const { entitlements } = useAuth();
  const { formatPrice, locale } = useSalonFormatting();
  const query = useOwnerBriefing(tenantId, userId);
  const [open, setOpen] = useState(false);
  // Authentication/entitlement refusals must not keep showing cached evidence.
  const status = (query.error as { response?: { status?: number } } | null)?.response?.status;
  const refused = status === 401 || status === 403;
  const facts = refused ? undefined : query.data;
  const stamp = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: facts?.timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  const entitled = (code: string) => entitlements.some((entry) => entry.code === code);
  const actions = facts
    ? [
        ...(facts.refundsToday !== "0.00"
          ? [
              {
                title: "Review recorded refunds",
                reason: `${formatPrice(facts.refundsToday)} in refunds was recorded during this period. Refunds can relate to earlier sales.`,
                path: "/reports",
                module: "reports",
                label: "Open reports",
              },
            ]
          : []),
        ...(facts.lowStockCount > 0
          ? [
              {
                title: "Check stock before replenishing",
                reason: `${facts.lowStockCount} active products are at or below the stock threshold of ${facts.lowStockThreshold}. This is current stock, not historical stock.`,
                path: "/products",
                module: "catalogue",
                label: "Open products",
              },
            ]
          : []),
        ...(facts.appointmentsToday > 0
          ? [
              {
                title: "Review the day's appointments",
                reason: `${facts.appointmentsToday} bookings start in this period, excluding cancellations. This includes no-shows and is not a count of completed visits.`,
                path: "/appointments",
                module: "appointments",
                label: "Open appointments",
              },
            ]
          : []),
      ]
        .filter((action) => entitled(action.module))
        .slice(0, 3)
    : [];

  return (
    <section
      aria-labelledby="owner-briefing-title"
      className="rounded-card border border-line bg-surface p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="owner-briefing-title" className="text-lg">
            Owner briefing
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            A factual, read-only summary. Nothing is sent or activated.
          </p>
        </div>
        <Button variant="secondary" loading={query.isFetching} onClick={() => void query.refetch()}>
          {query.isError ? "Retry briefing" : "Refresh briefing"}
        </Button>
      </div>
      {!facts && !query.isError && (
        <p role="status" className="mt-4">
          Loading owner briefing…
        </p>
      )}
      {query.isError && (
        <p role="status" className="mt-4 text-danger">
          {refused
            ? "Your access to this briefing is no longer available."
            : facts
              ? "The briefing could not refresh. Showing the last successful snapshot; it may be out of date."
              : "The owner briefing could not be loaded. No figures are available. Please retry."}
        </p>
      )}
      {facts && (
        <>
          <p className="mt-4 text-sm text-ink-body">
            As of {stamp(facts.asOf)} · {facts.timeZone}
          </p>
          <details className="mt-2 text-sm text-ink-body">
            <summary className="w-fit cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-purple">
              Reporting window
            </summary>
            <p className="mt-1">
              {stamp(facts.from)} to {stamp(facts.to)} (end excluded).
            </p>
          </details>
          {(query.isStale || query.isFetching) && (
            <p role="status" className="mt-2 text-sm text-ink-muted">
              {query.isFetching
                ? "Refreshing snapshot…"
                : "This snapshot may be out of date. Refresh before acting."}
            </p>
          )}
          <p className="mt-4">
            {facts.salesToday === 0
              ? "No completed sales in this period."
              : `${facts.salesToday} completed receipts recorded ${formatPrice(facts.completedSalePaid)} paid before refunds.`}{" "}
            Refunds: {formatPrice(facts.refundsToday)}. Net paid after refunds:{" "}
            {formatPrice(facts.netPaid)}.
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Average paid per completed receipt: {formatPrice(facts.averageTicket)} before refunds.{" "}
            {facts.newCustomersToday} new customer records. Paid amounts may include prepaid
            redemptions; they are not cash-only takings or profit.
          </p>
          <h3 className="mt-5 font-bold">Suggested checks</h3>
          {actions.length ? (
            <ul className="mt-3 grid gap-3 lg:grid-cols-3">
              {actions.map((action) => (
                <li
                  key={action.path}
                  className="rounded-md border border-line-soft bg-surface-muted p-4"
                >
                  <h4 className="font-bold">{action.title}</h4>
                  <p className="text-sm text-ink-muted">{action.reason}</p>
                  <Link
                    className="inline-block py-2 text-sm font-bold text-purple underline"
                    to={action.path}
                  >
                    {action.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">
              No suggested checks from the available briefing metrics. This is not a complete
              assessment of the business.
            </p>
          )}
          <Button className="mt-4" variant="secondary" onClick={() => setOpen(true)}>
            View briefing evidence
          </Button>
          <Drawer
            open={open}
            onClose={() => setOpen(false)}
            title="Briefing evidence"
            widthClassName="max-w-xl"
            description="Definitions and source screens for this snapshot. Opening a screen does not apply this reporting window automatically."
          >
            <div className="space-y-4 p-6 text-sm">
              <p>
                Snapshot: {stamp(facts.asOf)} · {facts.timeZone}
              </p>
              <p>
                Exact interval: <time>{facts.from}</time> ≤ record time &lt; <time>{facts.to}</time>
                .
              </p>
              <dl className="space-y-3">
                <div>
                  <dt className="font-bold">
                    Completed-sale paid amounts: {formatPrice(facts.completedSalePaid)}
                  </dt>
                  <dd>
                    Sum of paid amounts on completed receipts sold in the window. Includes all
                    tender types, including prepaid redemption.
                  </dd>
                </div>
                <div>
                  <dt className="font-bold">Refunds: {formatPrice(facts.refundsToday)}</dt>
                  <dd>
                    Refund amounts recorded in the window, regardless of the original sale date.
                  </dd>
                </div>
                <div>
                  <dt className="font-bold">Net paid: {formatPrice(facts.netPaid)}</dt>
                  <dd>Completed-sale paid amounts minus recorded refunds. Can be negative.</dd>
                </div>
                <div>
                  <dt className="font-bold">Average ticket: {formatPrice(facts.averageTicket)}</dt>
                  <dd>
                    Completed-sale paid amounts divided by {facts.salesToday} completed receipts,
                    before refunds. Zero when there are no completed receipts.
                  </dd>
                </div>
                <div>
                  <dt className="font-bold">Appointments: {facts.appointmentsToday}</dt>
                  <dd>
                    Bookings starting in the window, excluding cancellations; not a
                    completed-service count.
                  </dd>
                </div>
                <div>
                  <dt className="font-bold">New customers: {facts.newCustomersToday}</dt>
                  <dd>
                    Customer records created in the window, not necessarily first-time visitors.
                  </dd>
                </div>
                <div>
                  <dt className="font-bold">Low-stock products: {facts.lowStockCount}</dt>
                  <dd>
                    Current active products at or below tenant threshold {facts.lowStockThreshold};
                    not a historical balance.
                  </dd>
                </div>
              </dl>
              <nav aria-label="Briefing source screens" className="flex flex-wrap gap-4">
                {entitled("reports") && (
                  <Link to="/reports" className="text-purple underline">
                    Reports source screen
                  </Link>
                )}
                {entitled("appointments") && (
                  <Link to="/appointments" className="text-purple underline">
                    Appointments source screen
                  </Link>
                )}
                {entitled("customers") && (
                  <Link to="/customers" className="text-purple underline">
                    Customers source screen
                  </Link>
                )}
                {entitled("catalogue") && (
                  <Link to="/products" className="text-purple underline">
                    Products source screen
                  </Link>
                )}
              </nav>
              <p className="text-ink-muted">
                Metrics may refresh at different times from other dashboard tiles. No trends,
                revenue forecasts, bookable-capacity claims or message recommendations are inferred
                here.
              </p>
            </div>
          </Drawer>
        </>
      )}
    </section>
  );
}
