import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, getErrorMessage } from "@/lib/api";
import Button from "@/components/ui/Button";
import PayrollStatementLines from "./PayrollStatementLines";
import PayrollSalesRatio from "./PayrollSalesRatio";

/**
 * CP-006 period report: frozen totals plus a per-staff breakdown with drill-down.
 *
 * Shown for an approved month to the owner and to managers, because it carries commission,
 * incentives, collections and base amounts only — never salary or take-home. Every figure
 * is copied from the approved snapshot the server verifies in one transaction. Commission is
 * split by the plan component the engine pooled it under, and the salary-derived Payroll/Sales
 * % column appears only when the server sent it, which it does for an owner reader.
 */

interface ReportStaffRow {
  staff: { id: string; name: string; disabled: boolean };
  payroll: { commission: string; incentive: string; collection: string };
  /** The plan components the frozen commission was actually pooled under. */
  commissionComponents: { componentKey: string; componentName: string; amount: string }[];
  /** Manual commission adjustments: components + this = payroll.commission. */
  commissionAdjustments: string;
  /** Salary-derived KPI. Absent unless the server considered the reader an owner. */
  payrollSalesPct?: string | null;
  alert?: boolean;
  lines: number;
  baseAmount: string;
  units: string;
  outlets: string[];
  commissionTypes: string[];
}

export interface PayrollReportView {
  periodKey: string;
  currency: string;
  timeZone: string;
  calculation: { version: string; inputHash: string; calculatedAt: string };
  approval: { at: string; reason: string };
  commissionColumns: { key: string; name: string }[];
  totals: {
    staff: number;
    lines: number;
    commission: string;
    incentive: string;
    collection: string;
    baseAmount: string;
    units: string;
  };
  staff: ReportStaffRow[];
}

/** One labelled frozen figure. Never formatted into a float. */
function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-surface-muted px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-base font-heavy text-ink">{value}</dd>
    </div>
  );
}

export default function PayrollReport({ period }: { period: string }) {
  const [selected, setSelected] = useState<{ id: string; name: string; outlets: string[] } | null>(
    null,
  );
  const query = useQuery({
    queryKey: ["payroll-report", period],
    queryFn: () => get<PayrollReportView>(`/payroll-close/${period}/report`),
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(period),
    staleTime: 0,
  });
  const data = query.data;
  const showOutlets = Boolean(data?.staff.some((row) => row.outlets.length > 0));
  const commissionColumns = data?.commissionColumns ?? [];
  /** The owner's response carries the salary-derived ratio; a manager's does not. */
  const showSalesRatio = Boolean(data?.staff.some((row) => row.payrollSalesPct !== undefined));
  return (
    <section aria-label="Payroll period report" className="space-y-3">
      <h3 className="font-semibold">Period report</h3>
      <p className="text-sm text-ink-muted">
        Frozen approved snapshot. Money is copied from the stored statements, never recalculated, so
        these figures match the downloaded workbook to the cent.
      </p>
      {query.isFetching && <p aria-busy="true">Loading period report…</p>}
      {query.isError && (
        <p role="alert">
          {getErrorMessage(query.error)}{" "}
          <Button onClick={() => void query.refetch()}>Retry report</Button>
        </p>
      )}
      {data && !query.isError && (
        <>
          <dl className="grid grid-cols-2 gap-3 rounded-card border border-line p-4 md:grid-cols-4">
            <Figure label="Staff" value={data.totals.staff} />
            <Figure label="Commission" value={data.totals.commission} />
            <Figure label="Incentive" value={data.totals.incentive} />
            <Figure label="Collected" value={data.totals.collection} />
            <Figure label="Base lines" value={data.totals.lines} />
            <Figure label="Base amount (4 dp)" value={data.totals.baseAmount} />
            <Figure label="Units (4 dp)" value={data.totals.units} />
            <Figure label="Approved" value={data.approval.at} />
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption>Frozen staff breakdown for {data.periodKey}</caption>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Commission</th>
                  {/* SRS FR-CAL-01: commission per plan component, exactly as the
                      engine pooled it, then the manual commission adjustments. */}
                  {commissionColumns.map((column) => (
                    <th key={column.key}>{column.name}</th>
                  ))}
                  <th>Commission adj.</th>
                  <th>Incentive</th>
                  <th>Collected</th>
                  {showSalesRatio && <th>Payroll / sales %</th>}
                  <th>Base lines</th>
                  <th>Base amount (4 dp)</th>
                  {/* A frozen snapshot can still carry outlet names from before the
                      outlet UI was parked, so the column is data-driven: a salon
                      with no branches would otherwise read an em dash on every row. */}
                  {showOutlets && <th>Outlets</th>}
                  <th>Source detail</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((row) => (
                  <tr key={row.staff.id}>
                    <td>
                      {row.staff.name}
                      {row.staff.disabled ? " (departed)" : ""}
                    </td>
                    <td>{row.payroll.commission}</td>
                    {commissionColumns.map((column) => (
                      <td key={column.key}>
                        {row.commissionComponents.find(
                          (component) => component.componentKey === column.key,
                        )?.amount ?? "—"}
                      </td>
                    ))}
                    <td>{row.commissionAdjustments}</td>
                    <td>{row.payroll.incentive}</td>
                    <td>{row.payroll.collection}</td>
                    {showSalesRatio && (
                      <td>
                        <PayrollSalesRatio pct={row.payrollSalesPct} alert={row.alert} />
                      </td>
                    )}
                    <td>{row.lines}</td>
                    <td>{row.baseAmount}</td>
                    {showOutlets && <td>{row.outlets.join(", ") || "—"}</td>}
                    <td>
                      <Button
                        variant="secondary"
                        aria-label={`Base lines for ${row.staff.name}`}
                        onClick={() =>
                          setSelected({
                            id: row.staff.id,
                            name: row.staff.name,
                            outlets: row.outlets,
                          })
                        }
                      >
                        Base lines
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.staff.length === 0 && <p>No frozen statements in this period.</p>}
          {selected && (
            <PayrollStatementLines
              key={selected.id}
              period={period}
              staffId={selected.id}
              staffName={selected.name}
              outlets={selected.outlets}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </section>
  );
}
