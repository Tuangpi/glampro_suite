import { formatPrice } from "@/lib/utils";
import { signedMoney, type PayrollImpact } from "./payroll-impact";

/** One rendering of the money, so the readiness check and the version comparison
 * can never diverge on amounts, labels or the zero-versus-missing distinction. */
export default function PayrollImpactTable({
  periodKey,
  impact,
}: {
  periodKey: string;
  impact: PayrollImpact;
}) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption>
            Commission and incentive per staff member for {periodKey}, posted month against saved
            rules
          </caption>
          <thead>
            <tr>
              <th>Staff</th>
              <th>Posted</th>
              <th>With saved rules</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {impact.rows.map((row) => (
              <tr key={row.staffId}>
                <td>
                  {row.staffName}
                  {row.disabled ? " (currently disabled)" : ""} · Assigned version{" "}
                  {row.assignedVersion.versionNo ?? "unknown"}
                </td>
                <td>{formatPrice(row.beforeTotal, impact.currency)}</td>
                <td>{formatPrice(row.afterTotal, impact.currency)}</td>
                <td>{signedMoney(row.change, impact.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Salon total</th>
              <td>{formatPrice(impact.totals.before, impact.currency)}</td>
              <td>{formatPrice(impact.totals.after, impact.currency)}</td>
              <td>{signedMoney(impact.totals.change, impact.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {!impact.rows.length && (
        <p>
          No staff had authoritative activity in this month. This is not evidence of zero earnings.
        </p>
      )}
      {!!impact.staffWithoutActivity.length && (
        <div>
          <p>On this plan with no authoritative activity this month:</p>
          <ul>
            {impact.staffWithoutActivity.map((staff) => (
              <li key={staff.staffId}>
                {staff.staffName}
                {staff.disabled ? " (currently disabled)" : ""} — no statement, and no zero amount
                is assumed.
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
