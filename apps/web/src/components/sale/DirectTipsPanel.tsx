import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  recordDirectTipSchema,
  type DirectTipList,
  type SaleDetail,
  type RecordDirectTipInput,
} from "@glampro_suite/shared";
import { get, post, getErrorMessage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { CONTROL_CLASS } from "@/components/ui/Field";

interface Props {
  sale: SaleDetail;
  staff: { id: string; name: string }[];
  canReturn: boolean;
}

/** Separate from receipts/tenders: evidence of money the salon did not collect. */
export default function DirectTipsPanel({ sale, staff, canReturn }: Props) {
  const { tenant, isReadOnly } = useAuth();
  const { formatPrice, formatDateTime } = useSalonFormatting();
  const client = useQueryClient();
  const queryKey = ["direct-staff-tips", tenant?.id, sale.id];
  const tips = useQuery({
    queryKey,
    queryFn: () => get<DirectTipList>(`/sales/${sale.id}/direct-tips`),
  });
  const [staffId, setStaffId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Retain the key across uncertain retries, including reopening the receipt.
  const attempt = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const storageKey = `direct-tip-attempt:${tenant?.id}:${sale.id}`;
  const save = useMutation({
    mutationFn: (input: RecordDirectTipInput) =>
      post<DirectTipList>(`/sales/${sale.id}/direct-tips`, input),
    onSuccess: (data) => {
      client.setQueryData(queryKey, data);
      attempt.current = null;
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Storage may be disabled. */
      }
      setAmount("");
      setError(null);
    },
    onError: (cause) => setError(getErrorMessage(cause)),
  });
  const giveBack = useMutation({
    mutationFn: (tipId: string) =>
      post<DirectTipList>(`/sales/${sale.id}/direct-tips/${tipId}/return`, {
        reason: reason.trim(),
      }),
    onSuccess: (data) => {
      client.setQueryData(queryKey, data);
      setReason("");
      setError(null);
    },
    onError: (cause) => setError(getErrorMessage(cause)),
  });
  const busy = save.isPending || giveBack.isPending;
  const eligible = sale.status === "COMPLETED" && sale.refundedAt === null && !isReadOnly;
  function record() {
    const fingerprint = JSON.stringify({ staffId, amount: Number(amount) });
    if (!attempt.current) {
      try {
        const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (
          stored &&
          typeof stored === "object" &&
          "fingerprint" in stored &&
          typeof stored.fingerprint === "string" &&
          "idempotencyKey" in stored &&
          typeof stored.idempotencyKey === "string"
        )
          attempt.current = {
            fingerprint: stored.fingerprint,
            idempotencyKey: stored.idempotencyKey,
          };
      } catch {
        /* Invalid or unavailable storage starts a new attempt. */
      }
    }
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, idempotencyKey: crypto.randomUUID() };
    const input = recordDirectTipSchema.safeParse({
      staffId,
      amount,
      idempotencyKey: attempt.current.idempotencyKey,
    });
    if (!input.success) {
      setError(
        "Choose a staff member and enter a positive amount with at most two decimal places.",
      );
      return;
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(attempt.current));
    } catch {
      /* In-memory retry still works. */
    }
    setError(null);
    save.mutate(input.data);
  }
  return (
    <section
      aria-label="Direct-to-staff tips"
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
    >
      <h3 className="text-base font-bold">Direct-to-staff tips</h3>
      {tips.data ? (
        <p className="text-sm text-ink-muted">
          {tips.data.items.length} tip {tips.data.items.length === 1 ? "record" : "records"} ·
          Separate from sale payments
        </p>
      ) : null}
      {tips.isPending ? <p role="status">Loading tip records…</p> : null}
      {tips.isError ? (
        <div role="alert">
          Could not load tips.{" "}
          <Button variant="secondary" onClick={() => void tips.refetch()}>
            Retry tip records
          </Button>
        </div>
      ) : null}
      <details>
        <summary className="min-h-control cursor-pointer content-center text-sm font-bold text-purple">
          View or record direct tips
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-ink-muted">
            Record only voluntary tips paid directly to staff, not collected by the salon. These are
            not sale payments, revenue, points or commission. No money is transferred. A sale void
            or refund does not return a tip.
          </p>
          <ul className="flex flex-col gap-2">
            {(tips.data?.items ?? []).map((tip) => (
              <li key={tip.id} className="text-sm">
                <p>
                  {formatPrice(tip.amount)} · {tip.staffName} · {formatDateTime(tip.recordedAt)} ·
                  recorded by {tip.recordedByName}
                </p>
                {tip.returnedAt ? (
                  <p>
                    Returned in full · {formatDateTime(tip.returnedAt)} · {tip.returnedByName}:{" "}
                    {tip.returnReason}
                  </p>
                ) : canReturn && !isReadOnly ? (
                  <Button
                    variant="secondary"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => giveBack.mutate(tip.id)}
                  >
                    Record full tip return for {tip.staffName} ({formatPrice(tip.amount)})
                  </Button>
                ) : (
                  <p>Not recorded as returned</p>
                )}
              </li>
            ))}
          </ul>
          {canReturn && !isReadOnly && tips.data?.items.some((tip) => !tip.returnedAt) ? (
            <Input
              label="Tip return reason"
              value={reason}
              maxLength={500}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              hint="Only record after the staff member has returned the full tip outside the till. Original tip history is retained."
            />
          ) : null}
          {eligible ? (
            <div className="flex flex-col gap-3">
              <label className="text-sm">
                Tip recipient
                <select
                  aria-label="Tip recipient"
                  className={CONTROL_CLASS}
                  value={staffId}
                  disabled={busy}
                  onChange={(event) => setStaffId(event.target.value)}
                >
                  <option value="">Choose staff</option>
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <Input
                label="Direct tip amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                disabled={busy}
                onChange={(event) => setAmount(event.target.value)}
              />
              <Button
                disabled={busy || tips.isPending || tips.isError || !staffId || !amount}
                onClick={record}
              >
                Record direct-to-staff tip
              </Button>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </details>
    </section>
  );
}
