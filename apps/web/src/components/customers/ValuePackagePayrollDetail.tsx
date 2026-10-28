import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  payrollValueHoldingDetailSchema,
  payrollValuePackageRefundAmounts,
  refundPayrollPackageSchema,
  type PayrollValueHoldingDetail,
} from "@glampro_suite/shared";
import { get, post, getErrorMessage } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/idempotency";
import { useAuth } from "@/contexts/AuthContext";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";

function cents(value: string) {
  if (!/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))
    throw new Error("Enter a non-negative amount with at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}
const money = (value: string | null) =>
  value === null
    ? "Unavailable"
    : `${BigInt(value) / 100n}.${(BigInt(value) % 100n).toString().padStart(2, "0")}`;

export default function ValuePackagePayrollDetail({
  customerId,
  holdingId,
  onClose,
}: {
  customerId: string;
  holdingId: string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["value-package-payroll-detail", customerId, holdingId],
    queryFn: async () =>
      payrollValueHoldingDetailSchema.parse(
        await get(`/customers/${customerId}/prepaid/${holdingId}/payroll`),
      ),
  });
  return (
    <Modal open onClose={onClose} title="Original value-package economics" size="lg">
      {query.isPending ? (
        <p role="status">Loading original credit evidence…</p>
      ) : query.isError ? (
        <p role="alert">{getErrorMessage(query.error)}</p>
      ) : query.data ? (
        <>
          <p>
            Captured purchase evidence only. No earnings are enabled. Promotional credit is not
            cash.
          </p>
          <dl>
            <dt>Original paid net</dt>
            <dd>{query.data.purchase?.paidNet ?? "Unavailable"}</dd>
            <dt>Original granted credit</dt>
            <dd>{query.data.purchase?.credit ?? "Unavailable"}</dd>
            <dt>Remaining credit</dt>
            <dd>{query.data.creditRemaining}</dd>
            <dt>Collected net</dt>
            <dd>{money(query.data.collectedNetCents)}</dd>
            <dt>Collected GST</dt>
            <dd>{money(query.data.collectedTaxCents)}</dd>
            <dt>Used net value (four-decimal evidence)</dt>
            <dd>
              {query.data.usedBaseTicks === null
                ? "Unavailable"
                : `${BigInt(query.data.usedBaseTicks) / 10000n}.${(BigInt(query.data.usedBaseTicks) % 10000n).toString().padStart(4, "0")}`}
            </dd>
            <dt>Original sellers</dt>
            <dd>
              {query.data.purchase?.sellers
                ?.map((row) => `${row.staffId} (${row.share / 100}%)`)
                .join(", ") ?? "Unavailable"}
            </dd>
          </dl>
          {query.data.missingEvidence.length ? (
            <p role="status">
              Refund unavailable: {query.data.missingEvidence.join(", ")}. Legacy gaps are not
              inferred.
            </p>
          ) : null}
          {query.data.refund ? (
            <section>
              <h3>Recorded refund</h3>
              <p>
                {money(query.data.refund.grossCents)} {query.data.purchase?.currency} ·{" "}
                {query.data.refund.payoutMethod}
              </p>
              <p>{query.data.refund.reason}</p>
              <p>Unused credit cancelled. Earned spend evidence is retained.</p>
            </section>
          ) : (
            <RefundForm
              key={`${holdingId}:${query.data.updatedAt}`}
              data={query.data}
              refreshing={query.isFetching || query.isError}
            />
          )}
        </>
      ) : null}
    </Modal>
  );
}

function RefundForm({
  data,
  refreshing,
}: {
  data: PayrollValueHoldingDetail;
  refreshing: boolean;
}) {
  const { user, isReadOnly } = useAuth();
  const client = useQueryClient();
  const [fee, setFee] = useState("0.00");
  const [reason, setReason] = useState("");
  const [tender, setTender] = useState("CASH");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const [key] = useState(newIdempotencyKey);
  const canManage = !isReadOnly && ["SUPER_ADMIN", "MANAGER"].includes(user?.globalRole ?? "");
  let quote: ReturnType<typeof payrollValuePackageRefundAmounts> | null = null;
  let quoteError: string | null = null;
  if (
    !data.missingEvidence.length &&
    !data.refunded &&
    data.originalTaxCents !== null &&
    data.collectedNetCents !== null &&
    data.collectedTaxCents !== null
  ) {
    try {
      quote = payrollValuePackageRefundAmounts({
        purchase: data.purchase,
        creditRemaining: data.creditRemaining,
        originalTaxCents: BigInt(data.originalTaxCents),
        collectedNet: BigInt(data.collectedNetCents),
        collectedTax: BigInt(data.collectedTaxCents),
        adminFeeNet: BigInt(cents(fee)),
      });
    } catch (cause) {
      quoteError = getErrorMessage(cause);
    }
  }
  if (!canManage || data.refunded || data.missingEvidence.length) return null;
  async function submit() {
    if (pending.current || !canManage || refreshing || !quote || !confirmed) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const input = refundPayrollPackageSchema.parse({
        idempotencyKey: key,
        expectedUpdatedAt: data.updatedAt,
        reason,
        adminFeeNetCents: cents(fee),
        payoutGrossCents: quote.gross.toString(),
        payoutMethod: quote.gross === 0n ? "NONE" : tender,
      });
      await post(`/sales/value-package-holdings/${data.holdingId}/refund`, input);
      setConfirmed(false);
      await client.invalidateQueries();
    } catch (cause) {
      setError(getErrorMessage(cause));
      setConfirmed(false);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 border border-line p-3">
      <h3>Refund unused value-package consideration</h3>
      <p>
        Preview = collected net − original paid-to-credit used value − approved fee (minimum zero).
        Original GST is separate. The server revalidates all evidence. This records a payout already
        made; it does not send money.
      </p>
      <Input
        label="Approved administration fee (net SGD)"
        value={fee}
        disabled={busy || refreshing}
        onChange={(event) => {
          setFee(event.target.value);
          setConfirmed(false);
        }}
      />
      {quote ? (
        <p role="status">
          Refund preview: {money(quote.gross.toString())} {data.purchase?.currency}
          {` (net ${money(quote.net.toString())}, GST ${money(quote.tax.toString())})`}
        </p>
      ) : null}
      {quoteError ? <p role="alert">{quoteError}</p> : null}
      <Input
        label="Refund reason"
        value={reason}
        maxLength={500}
        disabled={busy || refreshing}
        onChange={(event) => {
          setReason(event.target.value);
          setConfirmed(false);
        }}
      />
      {quote?.gross === 0n ? (
        <p>No payout: NONE. Remaining credit will be cancelled.</p>
      ) : (
        <Select
          label="Actual payout method"
          value={tender}
          disabled={busy || refreshing}
          options={["CASH", "CARD", "PAYNOW", "NETS", "BANK_TRANSFER"].map((value) => ({
            value,
            label: value,
          }))}
          onChange={(event) => {
            setTender(event.target.value);
            setConfirmed(false);
          }}
        />
      )}
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy || refreshing || !quote}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{" "}
        I confirm the exact payout and cancellation of all remaining credit.
      </label>
      <Button
        disabled={busy || refreshing || !quote || !confirmed || reason.trim().length < 3}
        onClick={() => void submit()}
      >
        Record value-package refund or cancellation
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
