import { AlertTriangle, Banknote, Calendar, Package, Users } from "@/components/icons";
import StatTile from "@/components/ui/StatTile";
import OwnerBriefing from "@/components/dashboard/OwnerBriefing";
import RebookingRecommendations from "@/components/dashboard/RebookingRecommendations";
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
  const { formatPrice } = useSalonFormatting();
  const { user } = useAuth();
  const summary = useDashboardSummary();

  const figures = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-xl">
          Welcome{user ? `, ${user.name.split(" ")[0]}` : ""} to Glampro Suite
        </h2>
        <p className="mt-1 max-w-xl text-sm text-ink-muted">
          Manage your sales, appointments, customers, stock and reports in one place.
        </p>
      </section>

      {/* One request, four tiles: the figures share a window, so they cannot be
          observed a moment apart and disagree. */}
      <section aria-label="Today at a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
        <p
          role="status"
          className="flex items-center gap-2 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          <AlertTriangle aria-hidden />
          Today&rsquo;s figures could not be loaded. Please try again shortly.
        </p>
      ) : null}
      <OwnerBriefing />
      <RebookingRecommendations />
    </div>
  );
}
