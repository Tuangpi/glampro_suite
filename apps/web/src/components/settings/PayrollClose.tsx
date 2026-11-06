import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PayrollAdjustment, PayrollStatement, QueryParams } from "@glampro_suite/shared";
import { downloadFile, get, post, getErrorMessage } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import PayrollCarry from "./PayrollCarry";
import PayrollReport from "./PayrollReport";
import PayrollSalesRatio from "./PayrollSalesRatio";

interface CloseView {
  periodKey: string;
  revision: number;
  status: "OPEN" | "CALCULATED" | "APPROVED";
  adjustments: PayrollAdjustment[];
  calculation: {
    statements: (Omit<PayrollStatement, "payroll"> & {
      payroll: Partial<PayrollStatement["payroll"]>;
      /** Server-totaled COMMISSION_ADJ: components + this = payroll.commission. */
      commissionAdjustments?: string;
    })[];
    /** Plan-component commission columns, in the order the server lists them. */
    commissionColumns: { key: string; name: string }[];
    calculatedAt: string;
  } | null;
  approval: { at: string; reason: string } | null;
  payout: { at: string; reference: string } | null;
}

/** Frozen artefacts CP-006 exposes; kept in step with the API export routes. */
type PayrollExportKind = "workbook.xlsx" | "payslips.pdf" | "ledger.csv";

/** Salon-wide close; the server enforces roles and independently redacts salaries. */
export default function PayrollClose({
  canWrite,
  isOwner,
}: {
  canWrite: boolean;
  isOwner: boolean;
}) {
  const client = useQueryClient();
  const [month, setMonth] = useState("");
  const [period, setPeriod] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [staffId, setStaffId] = useState("");
  const [ledgerStaffId, setLedgerStaffId] = useState("");
  const [kind, setKind] = useState<PayrollAdjustment["kind"]>("ADDITION");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const query = useQuery({
    queryKey: ["payroll-close", period],
    queryFn: () => get<CloseView>(`/payroll-close/${period}`),
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(period),
    staleTime: 0,
  });
  const state = query.data;
  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body: object }) =>
      post(`/payroll-close/${period}/${action}`, body),
  });
  /** Frozen exports: the server renders them from the approved snapshot on each request. */
  const download = useMutation({
    mutationFn: ({ kind, query }: { kind: PayrollExportKind; query?: QueryParams }) =>
      downloadFile(`/payroll-close/${period}/exports/${kind}`, query, `payroll-${period}`),
    onSuccess: (filename) => {
      setError("");
      setNotice(`Downloaded ${filename}.`);
    },
    onError: (cause) => setError(getErrorMessage(cause)),
  });
  async function act(action: "calculate" | "approve" | "payout" | "adjustments") {
    setError("");
    setNotice("");
    if (!state || query.isFetching || state.periodKey !== period || !canWrite) return;
    try {
      if (action !== "calculate" && reason.trim().length < 3)
        throw new Error("Enter a reason of at least 3 characters.");
      let body: object = { expectedRevision: state.revision };
      if (action === "approve") body = { ...body, reason };
      if (action === "payout") {
        if (!reference.trim()) throw new Error("Enter the actual payout reference.");
        body = { ...body, reason, reference };
      }
      if (action === "adjustments") {
        if (
          !staffId.trim() ||
          !/^-?(0|[1-9]\d{0,11})\.\d{2}$/.test(amount) ||
          (kind !== "COMMISSION_ADJ" && amount.startsWith("-"))
        )
          throw new Error("Select staff and enter a valid amount with two decimal places.");
        body = { ...body, adjustment: { id: crypto.randomUUID(), staffId, kind, amount, reason } };
      }
      await mutation.mutateAsync({ action, body });
      setReason("");
      setAmount("");
      setReference("");
      setNotice(
        action === "payout"
          ? "Payout confirmation recorded. No funds were transferred."
          : "Payroll saved.",
      );
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      // Conflicts and changed source data must reload the current revision too.
      await client.invalidateQueries({ queryKey: ["payroll-close", period] });
    }
  }
  const busy = mutation.isPending || query.isFetching || download.isPending;
  const approved = state?.status === "APPROVED";
  const commissionColumns = state?.calculation?.commissionColumns ?? [];
  return (
    <Card title="Monthly payroll close">
      <p>
        Salon-wide payroll. Approval freezes statements; recording payout does not transfer money.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="Payroll month"
          type="month"
          value={month}
          disabled={mutation.isPending}
          onChange={(e) => setMonth(e.target.value)}
        />
        <Button
          disabled={mutation.isPending || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)}
          onClick={() => {
            setPeriod(month);
            setError("");
            setNotice("");
            void client.invalidateQueries({ queryKey: ["payroll-close", month] });
          }}
        >
          Load month
        </Button>
      </div>
      {query.isFetching && <p role="status">Loading payroll…</p>}
      {query.isError && (
        <div role="alert">
          {getErrorMessage(query.error)}{" "}
          <Button onClick={() => void query.refetch()}>Retry payroll</Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {state && !query.isError && (
        <>
          <p>
            {state.periodKey}: {state.status} · revision {state.revision}
          </p>
          {state.approval && <p>Approved: {state.approval.at}</p>}
          {state.payout && <p>Payout recorded: {state.payout.reference}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption>
                {approved ? "Frozen payroll statements" : "Draft payroll — not approved"}
              </caption>
              <thead>
                <tr>
                  <th>Staff</th>
                  {isOwner && <th>Salary</th>}
                  <th>Commission</th>
                  {/* SRS FR-CAL-01: commission per plan component. The engine pools
                      commission per component, so these are exactly the amounts it
                      paid, and with the adjustments column they add up to Commission. */}
                  {commissionColumns.map((column) => (
                    <th key={column.key}>{column.name}</th>
                  ))}
                  <th>Commission adj.</th>
                  <th>Incentive</th>
                  <th>Collection</th>
                  {isOwner && <th>Payroll / sales %</th>}
                  <th>Calculation detail</th>
                  {isOwner && <th>Take home</th>}
                </tr>
              </thead>
              <tbody>
                {state.calculation?.statements.map((row) => (
                  <tr key={row.staff.id}>
                    <td>
                      {row.staff.name}
                      {row.staff.disabled ? " (departed)" : ""}
                    </td>
                    {isOwner && <td>{row.payroll.basicSalary}</td>}
                    <td>{row.payroll.commission}</td>
                    {commissionColumns.map((column) => (
                      <td key={column.key}>
                        {row.result?.components.find(
                          (component) => component.componentKey === column.key,
                        )?.amount ?? "—"}
                      </td>
                    ))}
                    <td>{row.commissionAdjustments ?? "—"}</td>
                    <td>{row.payroll.incentive}</td>
                    <td>{row.payroll.collection}</td>
                    {isOwner && (
                      <td>
                        <PayrollSalesRatio
                          pct={row.payroll.payrollSalesPct}
                          alert={row.payroll.alert}
                        />
                      </td>
                    )}
                    <td>
                      {row.result && (
                        <details>
                          <summary>Commission breakdown for {row.staff.name}</summary>
                          <pre className="max-w-lg overflow-auto whitespace-pre-wrap">
                            {JSON.stringify(row.result, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                    {isOwner && <td>{row.payroll.takeHome}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.calculation && (
            <p className="text-sm text-ink-muted">
              Component columns are the plan components the commission was pooled under; with the
              commission adjustment column they add up to Commission. Payroll / sales % is take-home
              plus the company levy over the collected amount, red above the staff member’s alert
              percentage.
            </p>
          )}
          {!state.calculation && <p>Calculate to load authoritative staff and payroll inputs.</p>}
          <ul>
            {state.adjustments.map((row) => (
              <li key={row.id}>
                {row.staffId}: {row.kind} {row.amount} — {row.reason}
              </li>
            ))}
          </ul>
          {canWrite && (
            <div className="space-y-3">
              <Input
                label="Payroll action reason"
                placeholder="e.g. Approved after checking the July statements"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={busy}
              />
              {!approved && (
                <>
                  <Button disabled={busy} onClick={() => void act("calculate")}>
                    Calculate payroll
                  </Button>
                  <Select
                    label="Adjustment staff"
                    value={staffId}
                    disabled={busy}
                    onChange={(e) => setStaffId(e.target.value)}
                    placeholder="Select staff"
                    options={
                      state.calculation?.statements.map((row) => ({
                        value: row.staff.id,
                        label: row.staff.name,
                      })) ?? []
                    }
                  />
                  <Select
                    label="Adjustment kind"
                    value={kind}
                    disabled={busy}
                    onChange={(e) => setKind(e.target.value as PayrollAdjustment["kind"])}
                    options={[
                      "UNPAID_LEAVE",
                      "OVERTIME",
                      "ADDITION",
                      "DEDUCTION",
                      "COMMISSION_ADJ",
                    ].map((value) => ({ value, label: value }))}
                  />
                  <Input
                    label="Adjustment amount"
                    value={amount}
                    disabled={busy}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                  <Button
                    disabled={busy || !state.calculation}
                    onClick={() => void act("adjustments")}
                  >
                    Add adjustment
                  </Button>
                  {isOwner && (
                    <Button
                      disabled={busy || state.status !== "CALCULATED"}
                      onClick={() => void act("approve")}
                    >
                      Approve payroll
                    </Button>
                  )}
                </>
              )}
              {approved && isOwner && !state.payout && (
                <>
                  <Input
                    label="Actual payout reference"
                    placeholder="e.g. GIRO batch 2026-07"
                    value={reference}
                    disabled={busy}
                    onChange={(e) => setReference(e.target.value)}
                  />
                  <Button disabled={busy} onClick={() => void act("payout")}>
                    Record actual payout
                  </Button>
                </>
              )}
            </div>
          )}
          {canWrite && isOwner && !approved && (
            <PayrollCarry key={period} period={period} disabled={busy} />
          )}
          {approved && <PayrollReport key={period} period={period} />}
          {approved && isOwner && (
            <div className="space-y-3">
              <h3 className="font-semibold">Frozen exports</h3>
              <p>
                Downloads are rendered by the server from the approved snapshot, never from a newer
                draft.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <Button disabled={busy} onClick={() => download.mutate({ kind: "workbook.xlsx" })}>
                  Download workbook
                </Button>
                <Button disabled={busy} onClick={() => download.mutate({ kind: "payslips.pdf" })}>
                  Download payslips
                </Button>
                <Select
                  label="Ledger staff filter"
                  value={ledgerStaffId}
                  disabled={busy}
                  onChange={(e) => setLedgerStaffId(e.target.value)}
                  placeholder="All staff"
                  options={
                    state.calculation?.statements.map((row) => ({
                      value: row.staff.id,
                      label: row.staff.name,
                    })) ?? []
                  }
                />
                <Button
                  disabled={busy}
                  onClick={() =>
                    download.mutate({
                      kind: "ledger.csv",
                      query: ledgerStaffId ? { staffId: ledgerStaffId } : undefined,
                    })
                  }
                >
                  Download ledger
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
