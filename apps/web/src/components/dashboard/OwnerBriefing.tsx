import { Link } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useOwnerBriefing } from "@/hooks/useOwnerBriefing";
import Button from "@/components/ui/Button";

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

/**
 * Facts, not a report: one money line, one mix line, at most two checks. The
 * definitions behind each figure live in Reports and the Business questions
 * tab, so this panel does not restate the tiles above it or the tools below it.
 */
function Briefing({ tenantId, userId }: { tenantId: string; userId: string }) {
  const { entitlements } = useAuth();
  const { formatPrice, locale } = useSalonFormatting();
  const query = useOwnerBriefing(tenantId, userId);
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
  const money = facts
    ? [
        facts.salesToday === 0
          ? "No completed sales in this period"
          : `${formatPrice(facts.completedSalePaid)} paid`,
        `${formatPrice(facts.refundsToday)} refunded`,
        `${formatPrice(facts.netPaid)} net paid`,
      ].join(" · ")
    : "";
  const mix = facts
    ? [
        `${facts.salesToday} completed ${facts.salesToday === 1 ? "receipt" : "receipts"}`,
        `${formatPrice(facts.averageTicket)} average`,
        `${facts.newCustomersToday} new ${facts.newCustomersToday === 1 ? "customer" : "customers"}`,
      ].join(" · ")
    : "";

  return (
    <section
      aria-labelledby="owner-briefing-title"
      className="rounded-card border border-line bg-surface p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="owner-briefing-title" className="text-lg">
          Owner briefing
        </h2>
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
          <p className="mt-3 text-sm text-ink-muted">
            As of {stamp(facts.asOf)} · {facts.timeZone}
          </p>
          {(query.isStale || query.isFetching) && !query.isError && (
            <p role="status" className="mt-2 text-sm text-ink-muted">
              {query.isFetching
                ? "Refreshing snapshot…"
                : "This snapshot may be out of date. Refresh before acting."}
            </p>
          )}
          <p className="mt-3">{money}</p>
          <p className="mt-1 text-sm text-ink-body">{mix}</p>
          {facts.refundsToday !== "0.00" && (
            <p className="mt-3 text-sm text-ink-body">
              Refunds can relate to sales made earlier.{" "}
              {entitled("reports") && (
                <Link to="/reports" className="font-bold text-purple underline">
                  Review refunds
                </Link>
              )}
            </p>
          )}
          {facts.lowStockCount > 0 && (
            <p className="mt-1 text-sm text-ink-body">
              {facts.lowStockCount} {facts.lowStockCount === 1 ? "product is" : "products are"} at
              or below the stock threshold of {facts.lowStockThreshold}.{" "}
              {entitled("catalogue") && (
                <Link to="/products" className="font-bold text-purple underline">
                  Open products
                </Link>
              )}
            </p>
          )}
          <p className="mt-3 text-sm text-ink-muted">
            Paid amounts may include prepaid redemptions; they are not cash-only takings or profit.
          </p>
          <details className="mt-2 text-sm text-ink-body">
            <summary className="w-fit cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-purple">
              Reporting window
            </summary>
            <p className="mt-1">
              {stamp(facts.from)} to {stamp(facts.to)} (end excluded).
            </p>
          </details>
        </>
      )}
    </section>
  );
}
