import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, getErrorMessage } from "@/lib/api";
import Button from "@/components/ui/Button";

export default function OwnPayrollSessions({ period }: { period: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["own-payroll-sessions", period, page],
    queryFn: () =>
      get<{
        scope: string;
        total: number;
        pages: number;
        evidence: string;
        rows: {
          id: string;
          usedAt: string;
          quantity: number;
          share: number;
          packageId: string;
          status: string;
        }[];
      }>("/payroll-close/my-sessions", { period, page }),
    retry: false,
  });
  return (
    <section aria-label="My recorded package sessions" className="space-y-2">
      <h3 className="font-bold">My recorded package sessions</h3>
      {query.isError ? (
        <p role="alert">{getErrorMessage(query.error)}</p>
      ) : query.isPending ? (
        <p role="status">Loading your sessions…</p>
      ) : query.data.scope !== "SELF" ? (
        <p>Own session evidence unavailable.</p>
      ) : (
        <>
          <p className="text-xs text-ink-muted">{query.data.evidence}</p>
          {query.data.total === 0 ? (
            <p>No recorded package-session attribution for you this month.</p>
          ) : (
            <ul>
              {query.data.rows.map((row) => (
                <li key={row.id}>
                  {row.usedAt} · {row.packageId} · {row.quantity} session(s) · your share{" "}
                  {row.share / 100}% · {row.status}
                </li>
              ))}
            </ul>
          )}
          <Button disabled={page === 1 || query.isFetching} onClick={() => setPage(page - 1)}>
            Previous own session page
          </Button>
          <Button
            disabled={page >= query.data.pages || query.isFetching}
            onClick={() => setPage(page + 1)}
          >
            Next own session page
          </Button>
        </>
      )}
    </section>
  );
}
