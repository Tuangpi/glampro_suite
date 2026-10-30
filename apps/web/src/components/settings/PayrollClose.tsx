import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PayrollAdjustment, PayrollStatement } from "@glampro_suite/shared";
import { get, post, getErrorMessage } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import PayrollCarry from "./PayrollCarry";

interface CloseView {
  periodKey: string;
  revision: number;
  status: "OPEN" | "CALCULATED" | "APPROVED";
  adjustments: PayrollAdjustment[];
  calculation: { statements: PayrollStatement[]; calculatedAt: string } | null;
  approval: { at: string; reason: string } | null;
  payout: { at: string; reference: string } | null;
}

/** Kept unmounted until the server lifecycle/permission acceptance gate is met. */
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
  const busy = mutation.isPending || query.isFetching;
  const approved = state?.status === "APPROVED";
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
                  <th>Salary</th>
                  <th>Commission</th>
                  <th>Incentive</th>
                  <th>Collection</th>
                  <th>Take home</th>
                </tr>
              </thead>
              <tbody>
                {state.calculation?.statements.map((row) => (
                  <tr key={row.staff.id}>
                    <td>
                      {row.staff.name}
                      {row.staff.disabled ? " (departed)" : ""}
                    </td>
                    <td>{row.payroll.basicSalary}</td>
                    <td>{row.payroll.commission}</td>
                    <td>{row.payroll.incentive}</td>
                    <td>{row.payroll.collection}</td>
                    <td>{row.payroll.takeHome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        </>
      )}
    </Card>
  );
}
