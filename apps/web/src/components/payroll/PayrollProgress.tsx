import { useQuery } from "@tanstack/react-query";
import type { PayrollProgressRow, PayrollProgressView } from "@glampro_suite/shared";
import { get, getErrorMessage } from "@/lib/api";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Table, { type TableColumn } from "@/components/ui/Table";
import OwnPayrollSessions from "./OwnPayrollSessions";

/**
 * CP-006 month-to-date progress (FR-RPT-04, FR-POS-09).
 *
 * Every figure is a server projection of a stored payroll calculation: the surface
 * never adds up a page of rows and never recalculates a band. Until the month is
 * approved the card says **Estimated** and names the snapshot time, because postings
 * after that calculation are not in it; once approved it says **Frozen** and the same
 * numbers are the ones the period report and the exports show.
 *
 * `compact` renders one staff member's own line as a small definition list, which is
 * what the POS surface has room for.
 *
 * `selfOnly` is a **request**, not a label: it sends `scope=SELF` so the server narrows
 * the answer to the caller. A salon-wide answer must never be rendered here under a
 * "Your …" heading — an owner or manager holds a commission statement too, and the first
 * row of the salon table is whoever the loader happened to put first.
 */
export interface PayrollProgressProps {
  /** Payroll month; omitted reads the salon's current month. */
  period?: string;
  /** True for a self-service read: the server narrows the answer to the caller's line. */
  selfOnly?: boolean;
  compact?: boolean;
  /** My earnings opts in; the compact till card must not load session history. */
  showSessions?: boolean;
  title?: string;
}

/** A labelled figure. Money stays the server's decimal string, never a float. */
function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-surface-muted px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-heavy text-ink">{value}</dd>
    </div>
  );
}

/**
 * The salon-wide table. Columns are the same ten figures the API returns, in
 * reading order, with the money right-aligned so a manager can scan the column
 * rather than parse ten mixed-width cells.
 */
const COLUMNS: TableColumn<PayrollProgressRow>[] = [
  {
    key: "staff",
    header: "Staff",
    cell: (row) => (
      <span className="font-medium text-ink">
        {row.staff.name}
        {row.staff.disabled ? <span className="text-ink-muted"> (departed)</span> : null}
      </span>
    ),
  },
  {
    key: "plan",
    header: "Plan",
    cell: (row) => row.planName ?? (row.planId ? "—" : "Flat fallback"),
  },
  {
    key: "stage",
    header: "Stage",
    cell: (row) =>
      row.tenureMonth ? `${row.stageName} · month ${row.tenureMonth}` : row.stageName,
  },
  { key: "tier", header: "Tier component", cell: (row) => row.mainComponent ?? "—" },
  { key: "base", header: "Base month to date", align: "right", cell: (row) => row.mainBase },
  {
    key: "rate",
    header: "Rate now",
    align: "right",
    cell: (row) => (row.currentRate ? `${row.currentRate}%` : "—"),
  },
  { key: "gap", header: "To next band", align: "right", cell: (row) => row.gapToNext ?? "—" },
  { key: "commission", header: "Commission", align: "right", cell: (row) => row.commission },
  { key: "incentive", header: "Incentive", align: "right", cell: (row) => row.incentive },
  {
    key: "estimate",
    header: "Estimated total",
    align: "right",
    cell: (row) => <span className="font-heavy text-ink">{row.estimate}</span>,
  },
];

export default function PayrollProgress({
  period,
  selfOnly = false,
  compact = false,
  showSessions = !compact,
  title = "Month-to-date progress",
}: PayrollProgressProps) {
  const query = useQuery({
    queryKey: ["payroll-progress", period ?? "current", selfOnly],
    queryFn: () =>
      get<PayrollProgressView>(
        "/payroll-close/progress",
        // A self-service card asks the server to narrow, and it sends that even for an
        // owner or manager: scope is decided there, not by which row happens to be first.
        period || selfOnly
          ? { ...(period ? { period } : {}), ...(selfOnly ? { scope: "SELF" } : {}) }
          : undefined,
      ),
    staleTime: 0,
  });
  const data = query.data;
  /**
   * A "Your …" card renders a self-scoped answer only. If the server hands back the salon
   * table here — an older API, a lost flag — the honest answer is the empty state, not
   * another staff member's commission under the caller's own heading.
   */
  const rows = selfOnly ? (data?.scope === "SELF" ? data.rows : []) : (data?.rows ?? []);
  const own = rows[0];
  const currency = data?.currency ?? "SGD";
  return (
    <Card
      title={title}
      description="Commission progress for the payroll month, read from the last calculation."
      actions={
        <Button
          variant="secondary"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh
        </Button>
      }
    >
      <div role="group" aria-label="Month-to-date commission progress" className="space-y-3">
        {query.isFetching && !data && <p role="status">Loading progress…</p>}
        {query.isError && (
          <p role="alert">
            {getErrorMessage(query.error)}{" "}
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Retry progress
            </Button>
          </p>
        )}
        {data && (
          <>
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              {data.estimated ? (
                <Badge variant="warning" dot>
                  Estimated
                </Badge>
              ) : (
                <Badge variant="success" dot>
                  Frozen
                </Badge>
              )}
              <span>
                {data.periodKey} · {currency}
                {data.timeZone ? ` · ${data.timeZone}` : ""}
              </span>
            </p>
            <p className="text-sm text-ink-muted">
              {data.basis === "APPROVED" && data.approval
                ? `Approved ${data.approval.at}. These figures match the frozen period report and exports.`
                : data.basis === "ESTIMATED" && data.calculation
                  ? `Estimated from the calculation taken ${data.calculation.calculatedAt}. Later sales and redemptions appear after the month is recalculated; approval freezes it.`
                  : `No payroll has been calculated for ${data.periodKey} yet, so there is nothing to estimate. An owner or manager can calculate the month under Settings → Payroll close.`}
            </p>
            {rows.length === 0 && (
              <p>
                {selfOnly
                  ? `No payroll statement for you in ${data.periodKey}.`
                  : `No staff statement is part of the ${data.periodKey} calculation.`}
              </p>
            )}
            {compact && own && (
              <dl className="grid grid-cols-2 gap-2">
                <Figure
                  label="Plan"
                  value={own.planName ?? (own.planId ? "Plan" : "Flat fallback")}
                />
                <Figure
                  label="Stage"
                  value={
                    own.tenureMonth ? `${own.stageName} · month ${own.tenureMonth}` : own.stageName
                  }
                />
                <Figure
                  label={`Base month to date${own.mainComponent ? ` (${own.mainComponent})` : ""}`}
                  value={own.mainBase}
                />
                <Figure label="Rate now" value={own.currentRate ? `${own.currentRate}%` : "—"} />
                <Figure label="To next band" value={own.gapToNext ?? "—"} />
                <Figure label="Estimated commission" value={own.estimate} />
              </dl>
            )}
            {!compact && rows.length > 0 && (
              <Table
                caption={`Month-to-date commission progress for ${data.periodKey}`}
                columns={COLUMNS}
                rows={rows}
                rowKey={(row) => row.staff.id}
                className="rounded-lg"
                footer={
                  <tr className="text-sm">
                    <td className="px-4 py-3 text-ink-muted" colSpan={4}>
                      {data.totals.staff} staff · {data.totals.lines} base lines
                    </td>
                    <td className="px-4 py-3 text-right">{data.totals.baseAmount}</td>
                    <td className="px-4 py-3" colSpan={2} />
                    <td className="px-4 py-3 text-right">{data.totals.commission}</td>
                    <td className="px-4 py-3 text-right">{data.totals.incentive}</td>
                    <td className="px-4 py-3 text-right font-heavy">{data.totals.estimate}</td>
                  </tr>
                }
              />
            )}
            {data.basis !== "NOT_CALCULATED" && (
              <p className="text-xs text-ink-muted">
                Figures are copied from the stored calculation snapshot ({data.calculation?.version}{" "}
                {data.calculation?.inputHash.slice(0, 12)}), not recalculated here.
              </p>
            )}
            {selfOnly && own?.activity && (
              <section aria-label="My commission activity" className="space-y-2">
                <h3 className="font-bold">My commission activity</h3>
                <p className="text-xs text-ink-muted">
                  Activity from the last calculation, not live session attendance. Commission is
                  pooled by plan component, not allocated to each type.
                </p>
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Your activity by commission type</caption>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Base (4 dp)</th>
                      <th>Units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {own.activity.map((row) => (
                      <tr key={row.commissionType}>
                        <td>{row.commissionType}</td>
                        <td>{row.baseAmount}</td>
                        <td>{row.units}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            {selfOnly && data.scope === "SELF" && showSessions && (
              <OwnPayrollSessions key={data.periodKey} period={data.periodKey} />
            )}
          </>
        )}
      </div>
    </Card>
  );
}
