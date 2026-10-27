import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  recordSaleCollectionSchema,
  saleCollectionStateSchema,
  type RecordSaleCollectionInput,
  type SaleDetail,
} from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import { queryKeys } from "@/constants/queryKeys";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { get, getErrorMessage, post } from "@/lib/api";
import { getOutletId } from "@/lib/outlet-storage";

/** Parse typed amounts without rounding fractional cents or converting through Number. */
function inputCents(value: string): bigint | null {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function price(cents: string): string {
  const value = BigInt(cents);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

/** Keyed boundary prevents a receipt/account/outlet switch from reusing a draft. */
export default function SaleCollectionsPanel({ sale }: { sale: SaleDetail }) {
  const { tenant, user } = useAuth();
  const identity = JSON.stringify([tenant?.id, user?.id, getOutletId(), sale.id]);
  return <CollectionPanel key={identity} sale={sale} identity={identity} />;
}

function CollectionPanel({ sale, identity }: { sale: SaleDetail; identity: string }) {
  const { tenant, user, isReadOnly } = useAuth();
  const { formatPrice, formatDateTime } = useSalonFormatting();
  const client = useQueryClient();
  const storageKey = `glampro.sale-collection-attempt.v1:${identity}`;
  const [attempt, setAttempt] = useState<RecordSaleCollectionInput | null>(() => {
    try {
      const parsed = recordSaleCollectionSchema.safeParse(
        JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
      );
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  });
  const queryKey = queryKeys.sale.collections(
    tenant?.id ?? "",
    user?.id ?? "",
    getOutletId() ?? "",
    sale.id,
  );
  const state = useQuery({
    queryKey,
    queryFn: async () => {
      const data = saleCollectionStateSchema.parse(await get(`/sales/${sale.id}/collections`));
      if (data.saleId !== sale.id)
        throw new Error("Collection balance belongs to a different sale.");
      return data;
    },
    enabled: !!tenant && !!user,
  });
  const [amount, setAmount] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // React's pending state alone does not synchronously block two activations.
  const sending = useRef(false);
  function clearAttempt() {
    sessionStorage.removeItem(storageKey);
    setAttempt(null);
  }
  const save = useMutation({
    retry: false,
    mutationFn: async (input: RecordSaleCollectionInput) =>
      saleCollectionStateSchema.parse(await post(`/sales/${sale.id}/collections`, input)),
    onSuccess: (data) => {
      client.setQueryData(queryKey, data);
      try {
        clearAttempt();
      } catch {
        setError(
          "Payment saved, but the retry record could not be cleared. Reload before recording another payment.",
        );
        return;
      }
      setAmount("");
      setAllocations({});
      setReason("");
      setConfirmation(null);
      setError(null);
      setSaved(true);
      void client.invalidateQueries({ queryKey: queryKeys.customers.all() });
      void client.invalidateQueries({ queryKey: queryKeys.reports.all() });
      void client.invalidateQueries({ queryKey: queryKeys.dashboard.summary() });
    },
    onError: (cause) => {
      setConfirmation(null);
      // A transport/5xx failure may follow a commit. Freeze the original request.
      const status = isAxiosError(cause) ? cause.response?.status : undefined;
      if (status && [400, 401, 403, 404, 409, 422].includes(status)) {
        try {
          clearAttempt();
        } catch {
          /* Keep the saved request until storage is available. */
        }
        void state.refetch();
      }
      setError(getErrorMessage(cause));
    },
    onSettled: () => {
      sending.current = false;
    },
  });
  const data = state.data;
  // A refetch that changes balance, allocations or eligibility needs fresh confirmation.
  const balanceSnapshot = JSON.stringify(data);
  const confirmed = confirmation === balanceSnapshot;
  const gross = inputCents(amount);
  const rows = (data?.lines ?? []).map((line) => ({
    line,
    cents: inputCents(allocations[line.saleLineId] || "0"),
  }));
  const valid =
    !!data &&
    data.canCollect &&
    data.saleId === sale.id &&
    data.currency === "SGD" &&
    gross !== null &&
    gross > 0n &&
    gross <= BigInt(data.outstandingCents) &&
    rows.every(
      ({ line, cents }) =>
        cents !== null &&
        cents + BigInt(line.allocatedGrossCents) <= BigInt(line.contractedGrossCents),
    ) &&
    rows.reduce((sum, row) => sum + (row.cents ?? 0n), 0n) === gross &&
    reason.trim().length >= 3;
  const eligible = sale.status === "COMPLETED" && sale.refundedAt === null && !isReadOnly;
  function changed() {
    setConfirmation(null);
    setSaved(false);
    setError(null);
  }
  function record() {
    if (sending.current || isReadOnly || !eligible || state.isError || !data) return;
    let input = attempt;
    if (!input) {
      if (!valid || !confirmed) return;
      input = recordSaleCollectionSchema.parse({
        idempotencyKey: crypto.randomUUID(),
        currency: "SGD",
        collected: true,
        grossCents: gross!.toString(),
        reason: reason.trim(),
        allocations: rows
          .filter((row) => row.cents! > 0n)
          .map(({ line, cents }) => ({
            saleLineId: line.saleLineId,
            grossCents: cents!.toString(),
          })),
      });
      // Do not send money evidence if a reload-safe retry identity cannot be saved.
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(input));
      } catch {
        setError(
          "Retry protection is unavailable. Enable session storage before recording this payment.",
        );
        return;
      }
      setAttempt(input);
    }
    sending.current = true;
    save.mutate(input);
  }

  return (
    <section
      aria-label="Later sale payments"
      className="rounded-card border border-line bg-surface p-4 print:hidden"
    >
      <h3 className="font-bold text-ink">Later payments</h3>
      <p className="text-sm text-ink-muted">
        Current debt is separate from the original checkout receipt. Record money already collected
        outside the till; this does not charge a card or transfer money. Earnings remain disabled.
      </p>
      {state.isPending ? <p role="status">Loading collection balance…</p> : null}
      {state.isError ? (
        <div role="alert">
          <p>Could not load the current collection balance. {getErrorMessage(state.error)}</p>
          <Button variant="secondary" onClick={() => void state.refetch()}>
            Retry collection balance
          </Button>
        </div>
      ) : null}
      {data && !state.isError ? (
        <>
          <p className="mt-3 font-bold">
            Current outstanding: {formatPrice(price(data.outstandingCents))}
          </p>
          {data.currency === null ? (
            <p>Collection currency is unknown. Historical payments will not be inferred.</p>
          ) : null}
          <p className="text-sm text-ink-muted">
            Explicit allocations are evidence only. Unallocated historical payments are not
            distributed across lines.
          </p>
          <ul className="my-3 flex flex-col gap-2">
            {data.lines.map((line, index) => (
              <li key={line.saleLineId} className="text-sm">
                Line {index + 1}: {line.itemName} · Contracted{" "}
                {formatPrice(price(line.contractedGrossCents))} · Explicitly allocated{" "}
                {formatPrice(price(line.allocatedGrossCents))}
              </li>
            ))}
          </ul>
          <h4 className="font-bold">Recorded later payments</h4>
          {!data.payments.length ? (
            <p className="text-sm">No later payments recorded.</p>
          ) : (
            <ul className="my-3 flex flex-col gap-3">
              {data.payments.map((payment) => (
                <li key={payment.collectionId} className="text-sm">
                  <p>
                    {formatPrice(price(payment.grossCents))} · {formatDateTime(payment.occurredAt)}{" "}
                    · {payment.reason}
                  </p>
                  <ul>
                    {payment.allocations.map((row) => (
                      <li key={row.saleLineId}>
                        {data.lines.find((line) => line.saleLineId === row.saleLineId)?.itemName ??
                          row.saleLineId}
                        : {formatPrice(price(row.grossCents))}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {isReadOnly ? <p>Read-only: recording payments is unavailable.</p> : null}
          {!data.canCollect && !attempt ? (
            <p>No new collection is available for this sale.</p>
          ) : null}
          {attempt ? (
            <div className="my-3 flex flex-col gap-2">
              <p role="status">
                A payment of {formatPrice(price(attempt.grossCents))} needs confirmation from the
                server. Retry the same request; do not collect the money again.
              </p>
              <p className="text-sm">{attempt.reason}</p>
              <Button
                loading={save.isPending}
                disabled={!eligible || state.isFetching}
                onClick={record}
              >
                Retry recorded payment
              </Button>
            </div>
          ) : eligible && data.canCollect ? (
            <div className="my-3 flex flex-col gap-3">
              <Input
                label="Later payment amount (SGD)"
                inputMode="decimal"
                value={amount}
                maxLength={13}
                onChange={(event) => {
                  changed();
                  setAmount(event.target.value);
                }}
              />
              {data.lines.map((line, index) => (
                <Input
                  key={line.saleLineId}
                  label={`Allocation to line ${index + 1}: ${line.itemName} (SGD)`}
                  inputMode="decimal"
                  value={allocations[line.saleLineId] ?? ""}
                  maxLength={13}
                  onChange={(event) => {
                    changed();
                    setAllocations((current) => ({
                      ...current,
                      [line.saleLineId]: event.target.value,
                    }));
                  }}
                />
              ))}
              <p className="text-sm">
                Allocate exactly the collected amount. Do not exceed current debt or a line’s
                unallocated contracted value. No allocation is filled automatically.
              </p>
              <Input
                label="Later payment reason"
                maxLength={500}
                value={reason}
                onChange={(event) => {
                  changed();
                  setReason(event.target.value);
                }}
              />
              <Checkbox
                label="I confirm this money was collected in SGD and these line allocations are correct."
                checked={confirmed}
                onChange={(event) => setConfirmation(event.target.checked ? balanceSnapshot : null)}
              />
              <Button
                disabled={!valid || !confirmed || state.isFetching}
                loading={save.isPending}
                onClick={record}
              >
                Record later payment
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {saved ? <p role="status">Later payment recorded. Current debt has been updated.</p> : null}
    </section>
  );
}
