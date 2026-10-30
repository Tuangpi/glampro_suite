import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, getErrorMessage } from "@/lib/api";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Field, { CONTROL_CLASS } from "@/components/ui/Field";

interface Balance {
  staffId: string;
  carryForward: { componentKey: string; base: string; units: string }[];
  fallbackCarryCommission: string;
}
interface CarryView {
  periodKey: string;
  availability: "READY" | "UNAVAILABLE";
  openingEligible: boolean;
  openingRevision: number;
  opening: { staff: Balance[] } | null;
  staffInventory: { id: string; name: string; disabled: boolean }[];
  balances: (Balance & { balanceHash: string })[];
  settlements: { staffId: string; revision: number; stale: boolean }[];
}

/** Owner-only, non-activating authorization controls. No inferred zero inventory. */
export default function PayrollCarry({ period, disabled }: { period: string; disabled: boolean }) {
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [inventory, setInventory] = useState("");
  const [staffId, setStaffId] = useState("");
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [writeOffFallback, setWriteOffFallback] = useState(false);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saving = useRef(false);
  const query = useQuery({
    queryKey: ["payroll-carry", period],
    queryFn: () => get<CarryView>(`/payroll-close/${period}/carry`),
    enabled,
    staleTime: 0,
  });
  const data = query.data?.periodKey === period && !query.isError ? query.data : undefined;
  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body: object }) =>
      post(`/payroll-close/${period}/${action}`, body),
  });
  const busy = disabled || query.isFetching || mutation.isPending;
  const balance = data?.balances.find((row) => row.staffId === staffId);
  async function save(action: "opening" | "settlements") {
    setError("");
    setNotice("");
    if (!data || busy || saving.current) return;
    saving.current = true;
    try {
      if (!confirmed || reason.trim().length < 3 || !reference.trim())
        throw new Error("Confirm the reviewed evidence and enter a reason and evidence reference.");
      const evidence = { reference: reference.trim() };
      let body: object;
      if (action === "opening") {
        if (!data.openingEligible) throw new Error("Opening is restricted to the first close.");
        const staff: unknown = JSON.parse(inventory);
        if (!Array.isArray(staff)) throw new Error("Opening inventory must be a JSON array.");
        body = { expectedRevision: data.openingRevision, staff, evidence, reason };
      } else {
        if (!balance || (!fromKey && !writeOffFallback))
          throw new Error("Select a balance and at least one settlement action.");
        body = {
          expectedRevision: data.settlements.find((row) => row.staffId === staffId)?.revision ?? 0,
          staffId,
          balanceHash: balance.balanceHash,
          components: fromKey ? [{ fromKey, toKey: toKey.trim() || null, reason }] : [],
          fallbackWriteOff: writeOffFallback ? { amount: balance.fallbackCarryCommission } : null,
          evidence,
          reason,
        };
      }
      await mutation.mutateAsync({ action, body });
      setConfirmed(false);
      setReason("");
      setReference("");
      setNotice(
        "Carry authorization saved. Recalculate payroll before approval. No cash was moved.",
      );
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setConfirmed(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["payroll-carry", period] }),
        client.invalidateQueries({ queryKey: ["payroll-close", period] }),
      ]);
      saving.current = false;
    }
  }
  return (
    <section className="space-y-3" aria-label="Owner carry authorizations">
      <h3 className="font-semibold">Opening carry and debt settlements</h3>
      <p>
        Owner authorization only. This does not activate earnings, transfer funds or reconstruct
        legacy balances.
      </p>
      <Button
        disabled={busy}
        onClick={() => {
          setConfirmed(false);
          if (enabled) void query.refetch();
          else setEnabled(true);
        }}
      >
        Load carry evidence
      </Button>
      {query.isError && <p role="alert">{getErrorMessage(query.error)}</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {data && (
        <>
          <p>
            Saving a settlement replaces that staff member’s previous disposition for this month.
            Review all debt actions before reauthorizing.
          </p>
          {data.availability === "UNAVAILABLE" && (
            <p>No approved previous close or authorized opening. Calculation remains blocked.</p>
          )}
          <ul>
            {data.staffInventory.map((row) => (
              <li key={row.id}>
                {row.name}
                {row.disabled ? " (departed)" : ""} — {row.id}
              </li>
            ))}
          </ul>
          {data.openingEligible && (
            <>
              <p>
                Explicitly include every staff member, including departed staff and reviewed zero
                balances. Opening must be authorized before its month starts.
              </p>
              <Field
                label="Reviewed opening inventory (JSON)"
                hint={
                  "Array of {staffId, carryForward: [{componentKey, base, units}], fallbackCarryCommission}. Bases/units use four decimals; fallback debt uses ten. Nonpositive balances only."
                }
              >
                {({ controlId, describedBy }) => (
                  <textarea
                    id={controlId}
                    aria-describedby={describedBy}
                    className={`${CONTROL_CLASS} min-h-36 p-3 font-mono`}
                    value={inventory}
                    disabled={busy}
                    onChange={(event) => {
                      setInventory(event.target.value);
                      setConfirmed(false);
                    }}
                  />
                )}
              </Field>
              {data.opening && (
                <pre className="overflow-auto text-xs">
                  {JSON.stringify(data.opening.staff, null, 2)}
                </pre>
              )}
              <Button
                disabled={busy || !confirmed || !inventory.trim()}
                onClick={() => void save("opening")}
              >
                Authorize opening inventory
              </Button>
            </>
          )}
          {data.availability === "READY" && (
            <>
              <Select
                label="Carry settlement staff"
                value={staffId}
                disabled={busy}
                options={data.balances.map((row) => ({
                  value: row.staffId,
                  label:
                    data.staffInventory.find((staff) => staff.id === row.staffId)?.name ??
                    row.staffId,
                }))}
                onChange={(event) => {
                  setStaffId(event.target.value);
                  setFromKey("");
                  setToKey("");
                  setWriteOffFallback(false);
                  setConfirmed(false);
                }}
              />
              {balance && (
                <>
                  <pre className="overflow-auto text-xs">{JSON.stringify(balance, null, 2)}</pre>
                  {data.settlements.find((row) => row.staffId === staffId)?.stale && (
                    <p role="alert">
                      Existing settlement is stale. Review the changed balance and reauthorize
                      before calculation.
                    </p>
                  )}
                  <Select
                    label="Source carry component"
                    value={fromKey}
                    disabled={busy}
                    placeholder="No component action"
                    options={balance.carryForward.map((row) => ({
                      value: row.componentKey,
                      label: `${row.componentKey}: ${row.base} / ${row.units}`,
                    }))}
                    onChange={(event) => {
                      setFromKey(event.target.value);
                      setConfirmed(false);
                    }}
                  />
                  <Input
                    label="Destination component key"
                    hint="Leave empty to explicitly write off the source component. Otherwise enter the new plan's exact component key."
                    value={toKey}
                    disabled={busy || !fromKey}
                    onChange={(event) => {
                      setToKey(event.target.value);
                      setConfirmed(false);
                    }}
                  />
                  {balance.fallbackCarryCommission.startsWith("-") &&
                    /[1-9]/.test(balance.fallbackCarryCommission) && (
                      <label className="flex gap-2">
                        <input
                          type="checkbox"
                          checked={writeOffFallback}
                          disabled={busy}
                          onChange={(event) => {
                            setWriteOffFallback(event.target.checked);
                            setConfirmed(false);
                          }}
                        />
                        Write off exact fallback debt {balance.fallbackCarryCommission}
                      </label>
                    )}
                  <Button
                    disabled={busy || !confirmed || (!fromKey && !writeOffFallback)}
                    onClick={() => void save("settlements")}
                  >
                    Authorize debt settlement
                  </Button>
                </>
              )}
            </>
          )}
          <Input
            label="Carry authorization reason"
            value={reason}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value);
              setConfirmed(false);
            }}
          />
          <Input
            label="Carry evidence reference"
            value={reference}
            disabled={busy}
            onChange={(event) => {
              setReference(event.target.value);
              setConfirmed(false);
            }}
          />
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I reviewed the complete inventory or exact debt disposition and supporting evidence.
          </label>
        </>
      )}
    </section>
  );
}
