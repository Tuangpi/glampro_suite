import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, getErrorMessage } from "@/lib/api";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";

/**
 * CP-006 base-line drill-down for one staff member's frozen statement.
 *
 * Every row is a stored base line; the source column is the record captured when the line
 * was posted. Nothing here recalculates money, so a later void cannot rewrite an approved
 * statement. Filters and paging are applied by the server.
 */

const COMMISSION_TYPES = [
  ["SVC", "Service"],
  ["PRD", "Product"],
  ["PKG_SALE", "Package sale"],
  ["PKG_RED", "Package redemption"],
  ["FOC", "FOC"],
  ["VP_SALE", "Value package sale"],
  ["VP_SPEND", "Value package spend"],
  ["GC_SALE", "Gift card sale"],
] as const;

const STATUSES = ["EARNED", "REVERSED", "PAID"] as const;

/** Page size stays modest: the totals cover every match, the list is a window. */
const PAGE_SIZE = 25;

interface StatementLine {
  line: {
    id: string;
    businessDate: string;
    commissionType: string;
    outletId: string | null;
    baseAmount: string;
    units: string;
    status: string;
    mode: string;
  };
  source: {
    sourceType: string;
    sourceId: string;
    saleId: string;
    occurredAt: string;
  } | null;
}

export interface StatementLinesView {
  periodKey: string;
  staff: { id: string; name: string };
  lines: StatementLine[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  matching: { lines: number; baseAmount: string; units: string };
}

export default function PayrollStatementLines({
  period,
  staffId,
  staffName,
  outlets,
  onClose,
}: {
  period: string;
  staffId: string;
  staffName: string;
  /** Outlet ids present in this staff member's frozen lines. */
  outlets: string[];
  onClose: () => void;
}) {
  const [outletId, setOutletId] = useState("");
  const [commissionType, setCommissionType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const params = {
    limit: PAGE_SIZE,
    page,
    ...(outletId ? { outletId } : {}),
    ...(commissionType ? { commissionType } : {}),
    ...(status ? { status } : {}),
  };
  const query = useQuery({
    queryKey: ["payroll-statement-lines", period, staffId, params],
    queryFn: () =>
      get<StatementLinesView>(`/payroll-close/${period}/statements/${staffId}/lines`, params),
    staleTime: 0,
  });
  const data = query.data;
  /** A narrower filter always starts at the first page. */
  const narrow = (apply: () => void) => {
    setPage(1);
    apply();
  };
  const first = data && data.total > 0 ? (data.page - 1) * data.limit + 1 : 0;
  const last = data ? Math.min(data.page * data.limit, data.total) : 0;
  return (
    <section
      aria-label={`Base lines for ${staffName}`}
      className="space-y-3 rounded-card border border-line p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold">Base lines · {staffName}</h4>
        <Button variant="secondary" onClick={onClose}>
          Close base lines
        </Button>
      </div>
      <p className="text-sm text-ink-muted">
        Frozen lines from the approved snapshot. The source is the record captured at posting time;
        later sales, voids or refunds never change these amounts.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Outlet filter"
          value={outletId}
          onChange={(event) => narrow(() => setOutletId(event.target.value))}
          placeholder="All outlets"
          options={outlets.map((id) => ({ value: id, label: id }))}
        />
        <Select
          label="Commission type filter"
          value={commissionType}
          onChange={(event) => narrow(() => setCommissionType(event.target.value))}
          placeholder="All types"
          options={COMMISSION_TYPES.map(([value, label]) => ({ value, label }))}
        />
        <Select
          label="Status filter"
          value={status}
          onChange={(event) => narrow(() => setStatus(event.target.value))}
          placeholder="All statuses"
          options={STATUSES.map((value) => ({ value, label: value }))}
        />
      </div>
      {query.isFetching && <p aria-busy="true">Loading base lines…</p>}
      {query.isError && (
        <p role="alert">
          {getErrorMessage(query.error)}{" "}
          <Button onClick={() => void query.refetch()}>Retry base lines</Button>
        </p>
      )}
      {data && !query.isError && (
        <>
          <p className="text-sm">
            {data.matching.lines} matching line{data.matching.lines === 1 ? "" : "s"} · base{" "}
            {data.matching.baseAmount} · units {data.matching.units}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption>Frozen base lines for {staffName}</caption>
              <thead>
                <tr>
                  <th>Business date</th>
                  <th>Type</th>
                  <th>Outlet</th>
                  <th>Status</th>
                  <th>Base (4 dp)</th>
                  <th>Units</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((row) => (
                  <tr key={row.line.id}>
                    <td>{row.line.businessDate}</td>
                    <td>{row.line.commissionType}</td>
                    <td>{row.line.outletId ?? "—"}</td>
                    <td>{row.line.status}</td>
                    <td>{row.line.baseAmount}</td>
                    <td>{row.line.units}</td>
                    <td>
                      {row.source
                        ? `${row.source.sourceType} ${row.source.sourceId} (sale ${row.source.saleId})`
                        : "No source record"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total === 0 && <p>No frozen line matches these filters.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <p>
              Showing {first}–{last} of {data.total} · page {data.page} of {data.pages || 1}
            </p>
            <Button
              variant="secondary"
              disabled={data.page <= 1}
              onClick={() => setPage(data.page - 1)}
            >
              Previous page
            </Button>
            <Button
              variant="secondary"
              disabled={data.page >= data.pages}
              onClick={() => setPage(data.page + 1)}
            >
              Next page
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
