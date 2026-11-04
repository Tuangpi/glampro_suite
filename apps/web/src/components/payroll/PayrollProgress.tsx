import { useQuery } from "@tanstack/react-query";
import type { PayrollProgressView } from "@glampro_suite/shared";
import { get, getErrorMessage } from "@/lib/api";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

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
 */
export interface PayrollProgressProps {
  /** Payroll month; omitted reads the salon's current month. */
  period?: string;
  /** True for a self-service read: the server narrows the answer to the caller's line. */
  selfOnly?: boolean;
  compact?: boolean;
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

export default function PayrollProgress({
  period,
  selfOnly = false,
  compact = false,
  title = "Month-to-date progress",
}: PayrollProgressProps) {
  const query = useQuery({
    queryKey: ["payroll-progress", period ?? "current", selfOnly],
    queryFn: () =>
      get<PayrollProgressView>("/payroll-close/progress", period ? { period } : undefined),
    staleTime: 0,
  });
  const data = query.data;
  const rows = data?.rows ?? [];
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
            {data.rows.length === 0 && (
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
            {!compact && data.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption>Month-to-date commission progress for {data.periodKey}</caption>
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Plan</th>
                      <th>Stage</th>
                      <th>Tier component</th>
                      <th>Base month to date</th>
                      <th>Rate now</th>
                      <th>To next band</th>
                      <th>Commission</th>
                      <th>Incentive</th>
                      <th>Estimated total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.staff.id}>
                        <td>
                          {row.staff.name}
                          {row.staff.disabled ? " (departed)" : ""}
                        </td>
                        <td>{row.planName ?? (row.planId ? "—" : "Flat fallback")}</td>
                        <td>
                          {row.tenureMonth
                            ? `${row.stageName} · month ${row.tenureMonth}`
                            : row.stageName}
                        </td>
                        <td>{row.mainComponent ?? "—"}</td>
                        <td>{row.mainBase}</td>
                        <td>{row.currentRate ? `${row.currentRate}%` : "—"}</td>
                        <td>{row.gapToNext ?? "—"}</td>
                        <td>{row.commission}</td>
                        <td>{row.incentive}</td>
                        <td>{row.estimate}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>
                        {data.totals.staff} staff · {data.totals.lines} base lines
                      </td>
                      <td>{data.totals.baseAmount}</td>
                      <td colSpan={2} />
                      <td>{data.totals.commission}</td>
                      <td>{data.totals.incentive}</td>
                      <td>{data.totals.estimate}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {data.basis !== "NOT_CALCULATED" && (
              <p className="text-xs text-ink-muted">
                Figures are copied from the stored calculation snapshot ({data.calculation?.version}{" "}
                {data.calculation?.inputHash.slice(0, 12)}), not recalculated here.
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
