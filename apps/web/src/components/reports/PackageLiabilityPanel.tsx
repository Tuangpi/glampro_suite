import { useQuery } from "@tanstack/react-query";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { get, getErrorMessage } from "@/lib/api";

type LiabilityReport = {
  asOf: string;
  rows: {
    holdingId: string;
    customerId: string;
    packageId: string;
    sessionsRemaining: number;
    expiresAt: string | null;
    expired: boolean;
    currency: string | null;
    remainingNet: string | null;
    commissionExposure: string | null;
    reason: string | null;
    exposureReason: string | null;
  }[];
};

export default function PackageLiabilityPanel() {
  const query = useQuery({
    queryKey: ["package-liability"],
    queryFn: () => get<LiabilityReport>("/reports/package-liability"),
    retry: false,
  });
  return (
    <Card
      title="Package liability by holding"
      description="Original remaining net purchase consideration and conditional redemption commission exposure. Company-wide current snapshot, independent of the sales range."
      actions={
        <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
          Refresh liability
        </Button>
      }
    >
      {query.isError ? (
        <p role="alert">{getErrorMessage(query.error)}</p>
      ) : query.isPending ? (
        <p role="status">Loading package liability…</p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            Snapshot {query.data.asOf}. Original remaining ordinals retain residual precision (four
            decimal places). Expired holdings are separate from active obligations; this is not
            statutory deferred revenue. Fixed/excluded exposure follows the captured purchase
            policy, before future splits and rounding. Follow-plan exposure is unavailable until the
            performer and effective plan/rules are known. Values are not cash collected or approved
            earnings; no sessions are reserved or posted.
          </p>
          {query.data.rows.length === 0 ? (
            <p>No outstanding package sessions.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption>Per-holding package liability and exposure</caption>
                <thead>
                  <tr>
                    <th>Holding / customer / package</th>
                    <th>Status</th>
                    <th>Sessions left</th>
                    <th>Expiry</th>
                    <th>Remaining net</th>
                    <th>Commission exposure</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((row) => (
                    <tr key={row.holdingId}>
                      <td>
                        {row.holdingId} / {row.customerId} / {row.packageId}
                      </td>
                      <td>{row.expired ? "Expired unused" : "Active unused"}</td>
                      <td>{row.sessionsRemaining}</td>
                      <td>{row.expiresAt ?? "No expiry"}</td>
                      <td>
                        {row.remainingNet !== null
                          ? `${row.currency} ${row.remainingNet}`
                          : `Unavailable: ${row.reason}`}
                      </td>
                      <td>
                        {row.commissionExposure !== null
                          ? `${row.currency} ${row.commissionExposure}`
                          : `Unavailable: ${row.exposureReason}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
