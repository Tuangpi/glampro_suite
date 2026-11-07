import { useQuery } from "@tanstack/react-query";
import { get, getErrorMessage } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

export default function PackageUtilisationPanel() {
  const query = useQuery({
    queryKey: ["package-utilisation"],
    queryFn: () =>
      get<{
        asOf: string;
        rows: {
          id: string;
          name: string;
          packsSold: number;
          sessionsSold: number | null;
          knownSessionsSold: number;
          unavailableSoldLines: number;
          sessionsRedeemed: number;
          sessionsExpiredUnused: number;
        }[];
      }>("/reports/package-utilisation"),
    retry: false,
  });
  return (
    <Card
      title="Package utilisation"
      description="Company-wide lifetime operational counts, independent of the sales date range. Not a liability or commission valuation."
      actions={
        <Button disabled={query.isFetching} onClick={() => void query.refetch()}>
          Refresh utilisation
        </Button>
      }
    >
      {query.isError ? (
        <p role="alert">{getErrorMessage(query.error)}</p>
      ) : query.isPending ? (
        <p role="status">Loading package utilisation…</p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            Snapshot {query.data.asOf}. Sold counts completed-sale packs and original granted
            sessions (including subsequently refunded sales); redeemed counts non-reverted sessions;
            expired counts unused sessions on current expired holdings. Transfers, deletions and
            legacy gaps mean these are not a balancing equation. Sold sessions are unavailable where
            original purchase evidence is missing; current catalogue session counts are never
            substituted.
          </p>
          {query.data.rows.length === 0 ? (
            <p>No package activity.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption>Package utilisation</caption>
                <thead>
                  <tr>
                    <th>Package</th>
                    <th>Packs sold</th>
                    <th>Sessions sold</th>
                    <th>Sessions redeemed</th>
                    <th>Expired unused sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.packsSold}</td>
                      <td>
                        {row.sessionsSold ??
                          `Unavailable (${row.knownSessionsSold ?? 0} known; ${row.unavailableSoldLines ?? 0} sale lines missing evidence)`}
                      </td>
                      <td>{row.sessionsRedeemed}</td>
                      <td>{row.sessionsExpiredUnused}</td>
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
