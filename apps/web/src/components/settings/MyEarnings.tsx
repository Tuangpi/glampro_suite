import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PayrollOwnStatements, PayrollStatement } from "@glampro_suite/shared";
import { get, getErrorMessage } from "@/lib/api";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import PayrollProgress from "@/components/payroll/PayrollProgress";
import { useAuth } from "@/contexts/AuthContext";

/**
 * CP-006 own-data staff self-service (FR-RPT-05).
 *
 * A staff member sees their own month-to-date progress and their own **frozen** months.
 * Everything on this panel comes from two server projections: the progress read model
 * and the frozen single-statement read, both of which the API narrows to the caller.
 * Salary, take-home and every other person's statement are not in either payload — the
 * salary boundary stays with the owner-only exports, and this panel does not widen it.
 */
interface OwnStatementDetail {
  staff: { id: string; name: string; disabled: boolean };
  result: PayrollStatement["result"];
  payroll: { commission: string; incentive: string; collection: string };
}

export default function MyEarnings() {
  const { user } = useAuth();
  const [openPeriod, setOpenPeriod] = useState<string | null>(null);
  // A cashier holds no commission statement, so the panel explains itself instead of
  // asking the API for rows the API would refuse.
  const eligible = Boolean(user && ["SUPER_ADMIN", "MANAGER", "STAFF"].includes(user.globalRole));
  const history = useQuery({
    queryKey: ["payroll-statements"],
    queryFn: () => get<PayrollOwnStatements>("/payroll-close/statements"),
    enabled: eligible,
  });
  const detail = useQuery({
    queryKey: ["payroll-statement", openPeriod],
    queryFn: () => get<OwnStatementDetail>(`/payroll-close/${openPeriod}/statement`),
    enabled: eligible && openPeriod !== null,
  });
  const statements = history.data?.statements ?? [];
  if (!eligible)
    return (
      <Card title="Your frozen statements">
        <p>Commission statements belong to the staff member they were calculated for.</p>
      </Card>
    );
  return (
    <>
      <PayrollProgress selfOnly compact showSessions title="Your month-to-date progress" />
      <Card
        title="Your frozen statements"
        description="Approved payroll months that include you, newest first."
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            Only your own approved months are listed. Basic salary and take-home are never shown
            here; they belong to the payslip the owner downloads.
          </p>
          {history.isPending && <p role="status">Loading your statements…</p>}
          {history.isError && (
            <p role="alert">
              {getErrorMessage(history.error)}{" "}
              <Button variant="secondary" size="sm" onClick={() => void history.refetch()}>
                Retry statements
              </Button>
            </p>
          )}
          {history.data && statements.length === 0 && (
            <p>No approved payroll month includes you yet.</p>
          )}
          {statements.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption>Your frozen payroll statements</caption>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Commission</th>
                    <th>Incentive</th>
                    <th>Collected</th>
                    <th>Base amount</th>
                    <th>Approved</th>
                    <th>Payout</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {statements.map((row) => (
                    <tr key={row.periodKey}>
                      <td>{row.periodKey}</td>
                      <td>{row.commission}</td>
                      <td>{row.incentive}</td>
                      <td>{row.collection}</td>
                      <td>{row.baseAmount}</td>
                      <td>{row.approvedAt}</td>
                      <td>{row.paidAt ?? "pending"}</td>
                      <td>
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Open your ${row.periodKey} statement`}
                          onClick={() => setOpenPeriod(row.periodKey)}
                        >
                          Statement
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {history.data?.hasMore && (
            <p className="text-xs text-ink-muted">
              Older months exist beyond the {history.data.limit} shown.
            </p>
          )}
          {openPeriod && (
            <section aria-label={`Your ${openPeriod} statement`} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-semibold">{openPeriod} statement</h4>
                <Button variant="ghost" size="sm" onClick={() => setOpenPeriod(null)}>
                  Close statement
                </Button>
              </div>
              {detail.isPending && <p role="status">Loading your statement…</p>}
              {detail.isError && <p role="alert">{getErrorMessage(detail.error)}</p>}
              {detail.data && (
                <>
                  <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div className="rounded-md bg-surface-muted px-3 py-2">
                      <dt className="text-xs text-ink-muted">Commission</dt>
                      <dd className="mt-0.5 text-sm font-heavy text-ink">
                        {detail.data.payroll.commission}
                      </dd>
                    </div>
                    <div className="rounded-md bg-surface-muted px-3 py-2">
                      <dt className="text-xs text-ink-muted">Incentive</dt>
                      <dd className="mt-0.5 text-sm font-heavy text-ink">
                        {detail.data.payroll.incentive}
                      </dd>
                    </div>
                    <div className="rounded-md bg-surface-muted px-3 py-2">
                      <dt className="text-xs text-ink-muted">Collected</dt>
                      <dd className="mt-0.5 text-sm font-heavy text-ink">
                        {detail.data.payroll.collection}
                      </dd>
                    </div>
                    <div className="rounded-md bg-surface-muted px-3 py-2">
                      <dt className="text-xs text-ink-muted">Incentives earned</dt>
                      <dd className="mt-0.5 text-sm font-heavy text-ink">
                        {detail.data.result.incentives.length}
                      </dd>
                    </div>
                  </dl>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <caption>Commission components</caption>
                      <thead>
                        <tr>
                          <th>Component</th>
                          <th>Method</th>
                          <th>Base</th>
                          <th>Rate</th>
                          <th>Commission</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.data.result.components.map((row) => (
                          <tr key={row.componentKey}>
                            <td>{row.componentName}</td>
                            <td>{row.method}</td>
                            <td>{row.pooledBase}</td>
                            <td>{row.ratePct ? `${row.ratePct}%` : "—"}</td>
                            <td>{row.amount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {detail.data.result.incentives.length > 0 && (
                    <ul>
                      {detail.data.result.incentives.map((row) => (
                        <li key={`${row.ruleKey}:${row.outletId ?? "salon"}`}>
                          {row.ruleKey}: {row.amount} (individual {row.individualMetric}
                          {row.groupMetric ? `, group ${row.groupMetric}` : ""})
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </Card>
    </>
  );
}
