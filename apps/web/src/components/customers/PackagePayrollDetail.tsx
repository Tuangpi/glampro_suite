import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  payrollHoldingDetailSchema,
  refundPayrollPackageSchema,
  type SaleDetail,
} from "@glampro_suite/shared";
import { get, post, getErrorMessage } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/idempotency";
import { useAuth } from "@/contexts/AuthContext";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import SaleCollectionsPanel from "@/components/sale/SaleCollectionsPanel";
import { priceToCents } from "@/lib/money";
import { useStaffList } from "@/hooks/useStaff";
import CommissionAttributionEditor from "@/components/sale/CommissionAttributionEditor";
import type { CommissionShares } from "@glampro_suite/shared";

export default function PackagePayrollDetail({
  customerId,
  holdingId,
  onClose,
}: {
  customerId: string;
  holdingId: string;
  onClose: () => void;
}) {
  const { user, isReadOnly } = useAuth();
  const client = useQueryClient();
  const canManage = !isReadOnly && ["MANAGER", "SUPER_ADMIN"].includes(user?.globalRole ?? "");
  const staff = useStaffList({ page: 1, pageSize: 100, status: "active" }, canManage);
  const [corrections, setCorrections] = useState<Record<string, CommissionShares | undefined>>({});
  const query = useQuery({
    queryKey: ["package-payroll-detail", customerId, holdingId],
    queryFn: async () =>
      payrollHoldingDetailSchema.parse(
        await get(`/customers/${customerId}/session-packages/${holdingId}/payroll`),
      ),
  });
  const [reason, setReason] = useState("");
  const [fee, setFee] = useState("0.00");
  const [payout, setPayout] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const data = query.data;
  const money = (cents: string | null) =>
    cents === null
      ? "Unavailable"
      : `${(BigInt(cents) / 100n).toString()}.${(BigInt(cents) % 100n).toString().padStart(2, "0")}`;
  async function perform(action: () => Promise<unknown>) {
    if (busy || !canManage) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await client.invalidateQueries();
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Original package economics" size="lg">
      {query.isPending ? (
        <p role="status">Loading purchase evidence…</p>
      ) : query.isError ? (
        <p role="alert">{getErrorMessage(query.error)}</p>
      ) : data ? (
        <div className="space-y-4">
          <p>Captured evidence only. No new earnings are enabled. Legacy gaps are not inferred.</p>
          <dl>
            <dt>Original net consideration</dt>
            <dd>
              {data.currency ?? "Unknown currency"} {money(data.netCents)}
            </dd>
            <dt>Original session value (four-decimal floor)</dt>
            <dd>{data.sessionValue ?? "Unavailable"}; purchase ordinal residuals are preserved.</dd>
            <dt>Sessions</dt>
            <dd>
              {data.remainingSessions} remaining / {data.grantedSessions};{" "}
              {data.paidSessionsRemaining ?? "Unknown"} paid and available
            </dd>
            <dt>Balance due</dt>
            <dd>{money(data.balanceDueCents)}</dd>
            <dt>Original sellers</dt>
            <dd>
              {data.sellers?.map((row) => `${row.staffId} ${row.share / 100}%`).join(", ") ??
                "Unavailable"}
            </dd>
            <dt>Commission settings</dt>
            <dd>
              {data.settings
                ? `Sale: ${data.settings.sale.mode}; redemption: ${data.settings.redemption.mode}; minimum deposit ${data.settings.minimumDepositPct}%`
                : "Unavailable"}
            </dd>
          </dl>
          {data.missingEvidence.length ? (
            <p role="status">Missing evidence: {data.missingEvidence.join(", ")}</p>
          ) : null}
          <h3 className="font-bold">Payments</h3>
          <ul>
            {data.payments.map((row) => (
              <li key={row.id}>
                {row.occurredAt} · {money(row.grossCents)} gross; {money(row.netCents)} net;{" "}
                {money(row.taxCents)} GST
              </li>
            ))}
          </ul>
          {data.purchaseSaleId && !data.refunded ? (
            <SaleCollectionsPanel
              sale={
                { id: data.purchaseSaleId, status: "COMPLETED", refundedAt: null } as SaleDetail
              }
            />
          ) : null}
          <h3 className="font-bold">Sessions</h3>
          <p>
            Staff corrections reverse the old source and append a new source. Session void returns
            the original ordinals, not current catalogue value.
          </p>
          <Input
            label="Session action / refund reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy || !canManage}
          />
          <ul>
            {data.sessions.map((row, index) => (
              <li key={row.id} className="my-3 border border-line p-3">
                #{index + 1} · {row.usedAt} · {row.quantity} session(s) · base{" "}
                {row.baseAmount ?? "Unavailable"} · {row.revertedAt ? "Voided" : "Active"}
                <p>
                  Performed by:{" "}
                  {row.performers
                    ?.map((person) => `${person.staffId} ${person.share / 100}%`)
                    .join(", ") ?? "Unavailable"}
                  ; signature: {row.signature ? "Recorded" : "Not recorded"}
                </p>
                {canManage && !row.revertedAt && row.revision !== null ? (
                  <Button
                    disabled={busy || reason.trim().length < 3 || data.refunded}
                    onClick={() =>
                      void perform(() =>
                        post(`/sales/${row.saleId}/redemptions/${row.id}/void`, {
                          idempotencyKey: `${key}:${row.id}`,
                          expectedRevision: row.revision,
                          reason,
                        }),
                      )
                    }
                  >
                    Void session
                  </Button>
                ) : null}
                {canManage && !row.revertedAt && row.revision !== null ? (
                  <div>
                    <CommissionAttributionEditor
                      value={corrections[row.id] ? { performers: corrections[row.id] } : undefined}
                      performers={staff.data?.data ?? []}
                      disabled={busy}
                      onChange={(value) =>
                        setCorrections((current) => ({ ...current, [row.id]: value?.performers }))
                      }
                    />
                    <Button
                      disabled={busy || !corrections[row.id] || reason.trim().length < 3}
                      onClick={() =>
                        void perform(() =>
                          post(
                            `/sales/${row.saleId}/redemptions/${row.id}/attribution-corrections`,
                            {
                              idempotencyKey: `${key}:correct:${row.id}:${row.revision}`,
                              expectedRevision: row.revision,
                              performers: corrections[row.id],
                              reason,
                            },
                          ),
                        )
                      }
                    >
                      Correct session staff
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {canManage && !data.refunded && !data.missingEvidence.length ? (
            <section className="space-y-2 border border-line p-3">
              <h3 className="font-bold">Refund unused package consideration</h3>
              <p>
                Refund = collected net − original used-session value − approved fee (minimum zero).
                Original GST is separate. Already-earned redemption is retained. The server verifies
                the exact payout; this records a refund, it does not send money.
              </p>
              <Input
                label="Approved administration fee (net SGD)"
                value={fee}
                onChange={(event) => setFee(event.target.value)}
                disabled={busy}
              />
              <Input
                label="Cash refund paid (gross SGD)"
                value={payout}
                onChange={(event) => setPayout(event.target.value)}
                disabled={busy}
              />
              <Button
                disabled={busy || reason.trim().length < 3 || !payout}
                onClick={() =>
                  void perform(async () => {
                    const input = refundPayrollPackageSchema.parse({
                      idempotencyKey: key,
                      expectedUpdatedAt: data.updatedAt,
                      reason,
                      adminFeeNetCents: String(priceToCents(fee)),
                      payoutGrossCents: String(priceToCents(payout)),
                      payoutMethod: "CASH",
                    });
                    return post(`/sales/package-holdings/${holdingId}/refund`, input);
                  })
                }
              >
                Record approved cash refund
              </Button>
            </section>
          ) : null}
          {data.refunded ? (
            <p>Unused sessions refunded and cancelled; earned session evidence retained.</p>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </Modal>
  );
}
