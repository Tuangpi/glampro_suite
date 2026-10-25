import { Link } from "react-router";
import { AlertTriangle, Banknote, Calendar, Package, Plus, Users } from "@/components/icons";
import StatTile from "@/components/ui/StatTile";
import Button from "@/components/ui/Button";
import OwnerBriefing from "@/components/dashboard/OwnerBriefing";
import DashboardTools from "@/components/dashboard/DashboardTools";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboardSummary } from "@/hooks/useDashboard";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

/**
 * Dashboard — handoff screen 05.
 *
 * The four stat tiles are **server-side aggregates** from one request
 * (`GET /api/reports/dashboard`), so the tiles and any later report read the
 * same counted figures rather than a count of rows the browser happens to hold
 * (ADR 0010). The window is the salon-local day sent as explicit instants
 * (see `hooks/useDashboard.ts`), matching the server's default timezone policy.
 *
 * When the summary request fails every figure reads "—": the screen never
 * invents a zero, because "no income today" and "the server did not answer"
 * are different statements and only one of them is true.
 */
export default function Dashboard() {
  const { formatPrice, locale, timeZone } = useSalonFormatting();
  const { user, tenant, entitlements, isReadOnly } = useAuth();
  const summary = useDashboardSummary();

  const figures = summary.isError ? undefined : summary.data;
  const entitled = (code: string) => entitlements.some((entry) => entry.code === code);
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
  const shortcutClass =
    "inline-flex min-h-control items-center justify-center gap-2 rounded-md px-4 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-ink-body">
            {date} · {timeZone}
          </p>
          <h2 className="mt-1 text-2xl">
            Welcome back{user ? `, ${user.name.trim().split(/\s+/)[0]}` : ""}
          </h2>
          <p className="mt-1 text-sm text-ink-body">Here is your salon at a glance.</p>
        </div>
        {user && (entitled("appointments") || (entitled("sales") && !isReadOnly)) && (
          <nav aria-label="Dashboard shortcuts" className="flex flex-wrap gap-2">
            {entitled("appointments") && (
              <Link
                to="/appointments"
                className={`${shortcutClass} border border-line bg-surface text-ink hover:bg-surface-2`}
              >
                <Calendar aria-hidden className="size-4" /> Appointments
              </Link>
            )}
            {entitled("sales") && !isReadOnly && (
              <Link
                to="/sale"
                className={`${shortcutClass} bg-purple text-white hover:bg-purple-dark`}
              >
                <Plus aria-hidden className="size-4" /> New sale
              </Link>
            )}
          </nav>
        )}
      </header>

      {/* One request, four tiles: the figures share a window, so they cannot be
          observed a moment apart and disagree. */}
      <section
        aria-label="Today at a glance"
        aria-busy={summary.isFetching}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile
          icon={<Banknote className="size-4.5" />}
          display={figures ? formatPrice(Number(figures.incomeToday)) : undefined}
          value={figures ? Number(figures.incomeToday) : undefined}
          label={
            figures
              ? `Today\u2019s income · ${figures.salesToday} ${
                  figures.salesToday === 1 ? "sale" : "sales"
                }`
              : "Today\u2019s income"
          }
          tone="purple"
        />
        <StatTile
          icon={<Calendar className="size-4.5" />}
          value={figures?.appointmentsToday}
          label="Appointments today"
          tone="success"
        />
        <StatTile
          icon={<Users className="size-4.5" />}
          value={figures?.newCustomersToday}
          label="New customers today"
          tone="neutral"
        />
        <StatTile
          icon={<Package className="size-4.5" />}
          value={figures?.lowStock}
          label="Low stock"
          tone="warning"
        />
      </section>

      {summary.isError ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          <AlertTriangle aria-hidden />
          <p className="flex-1">
            Today&rsquo;s figures could not be loaded. No current figures are available.
          </p>
          <Button
            variant="secondary"
            disabled={summary.isFetching}
            onClick={() => void summary.refetch()}
          >
            Retry figures
          </Button>
        </div>
      ) : null}
      {summary.isPending && (
        <p role="status" className="text-sm text-ink-body">
          Loading today&rsquo;s figures…
        </p>
      )}
      <OwnerBriefing />
      <DashboardTools
        key={`${tenant?.id}:${user?.id}:${user?.globalRole}:${entitlements
          .map((entry) => entry.code)
          .sort()
          .join(",")}`}
      />
    </div>
  );
}
