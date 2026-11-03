import { queryKeys } from "@/constants/queryKeys";
import { useQuery } from "@tanstack/react-query";
import {
  customerHoldingHistorySchema,
  type CustomerHoldingHistory,
  type CustomerHoldingHistoryRow,
} from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useModules } from "@/hooks/useSettings";
import { get, getErrorMessage } from "@/lib/api";

/**
 * A customer's purchases, payments, usage and what is left (FR-RPT-06).
 *
 * The three money figures are deliberately separate: unused session value, unused
 * credit and the source sale's outstanding balance. They are different liabilities and
 * adding them together would overstate what the salon owes. A legacy holding shows its
 * sessions with no money at all, because an unknown value is not a zero.
 */
export default function CustomerHoldingHistoryPanel({ customerId }: { customerId: string }) {
  const modules = useModules();
  if (modules.isPending) return <p role="status">Loading holding-history access…</p>;
  if (modules.isError)
    return (
      <div role="alert">
        Holding-history access could not be loaded.{" "}
        <Button onClick={() => void modules.refetch()}>Retry holding-history access</Button>
      </div>
    );
  return modules.data?.some((row) => row.code === "packages" && row.entitled) ? (
    <HoldingHistory key={customerId} customerId={customerId} />
  ) : null;
}

const STATUS_LABELS: Record<CustomerHoldingHistoryRow["status"], string> = {
  ACTIVE: "Active",
  EXPIRED: "Expired",
  EXHAUSTED: "Fully used",
  REFUNDED: "Refunded",
};

/** Payment evidence is exact cents on the wire; the till formats money, not integers. */
function centsToMoney(cents: string) {
  const padded = cents.padStart(3, "0");
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

export function HoldingHistory({ customerId }: { customerId: string }) {
  const { formatPrice, formatDate } = useSalonFormatting();
  const history = useQuery({
    queryKey: queryKeys.customers.holdingHistory(customerId),
    queryFn: async () =>
      customerHoldingHistorySchema.parse(await get(`/customers/${customerId}/holding-history`)),
  });
  return (
    <section
      aria-label="Package and credit history"
      className="rounded-card border border-line bg-surface p-5"
    >
      <h3 className="font-bold">Package and credit history</h3>
      <p className="text-sm text-ink-muted">
        Every holding this customer owns, including expired, used and refunded ones. Unused session
        value, unused credit and money still owed on the source sale are reported separately, so
        they are never added together.
      </p>
      {history.isPending ? (
        <p role="status">Loading holding history…</p>
      ) : history.isError ? (
        <div role="alert">
          {getErrorMessage(history.error)}{" "}
          <Button onClick={() => void history.refetch()}>Retry holding history</Button>
        </div>
      ) : (
        <Report report={history.data} formatPrice={formatPrice} formatDate={formatDate} />
      )}
    </section>
  );
}

function Report({
  report,
  formatPrice,
  formatDate,
}: {
  report: CustomerHoldingHistory;
  formatPrice: (value: string) => string;
  formatDate: (value: string) => string;
}) {
  const unvalued = report.unvalued.active.holdings + report.unvalued.expired.holdings;
  return (
    <>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Holding totals">
        <Figure
          label="Unused session value"
          value={formatPrice(report.active.gross)}
          note={`${report.active.holdings} holdings · ${report.active.sessionsRemaining} sessions`}
        />
        <Figure
          label="Expired unused value"
          value={formatPrice(report.expired.gross)}
          note={`${report.expired.holdings} holdings · ${report.expired.sessionsRemaining} sessions`}
        />
        <Figure
          label="Unused credit"
          value={formatPrice(report.credit.active.remaining)}
          note={`${report.credit.active.holdings} holdings · ${formatPrice(
            report.credit.expired.remaining,
          )} expired`}
        />
        <Figure
          label="Owed on these sales"
          value={formatPrice(report.receivable.sourceSaleOutstanding)}
          note={`${report.receivable.sales} sales · not split across lines`}
        />
      </dl>
      {unvalued ? (
        <p className="mt-3 text-sm text-ink-muted">
          {unvalued} holding{unvalued === 1 ? "" : "s"} have no purchase valuation evidence, so
          their sessions are counted but no value is claimed.
        </p>
      ) : null}
      {report.holdings.length ? (
        <ul className="mt-4 flex flex-col gap-3">
          {report.holdings.map((row) => (
            <Holding
              key={row.holdingId}
              row={row}
              formatPrice={formatPrice}
              formatDate={formatDate}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-4">This customer has no package or credit history.</p>
      )}
    </>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-md bg-surface-muted p-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="font-bold">{value}</dd>
      <dd className="text-sm text-ink-muted">{note}</dd>
    </div>
  );
}

function Holding({
  row,
  formatPrice,
  formatDate,
}: {
  row: CustomerHoldingHistoryRow;
  formatPrice: (value: string) => string;
  formatDate: (value: string) => string;
}) {
  const balance = row.sessions
    ? `${row.sessions.remaining} of ${row.sessions.granted} sessions left`
    : `${formatPrice(row.credit!.remaining)} of ${formatPrice(row.credit!.granted)} credit left`;
  return (
    <li className="rounded-md bg-surface-muted p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>{row.name}</strong>
        <span className="text-sm text-ink-muted">
          {row.kind === "SESSIONS" ? "Session package" : "Value package"} ·{" "}
          {STATUS_LABELS[row.status]}
        </span>
      </div>
      <p className="text-sm">
        {balance}
        {row.purchasedAt ? ` · Bought ${formatDate(row.purchasedAt)}` : ""}
        {row.expiresAt ? ` · Expires ${formatDate(row.expiresAt)}` : ""}
      </p>
      <p className="text-sm">
        {row.value
          ? `Unused value ${formatPrice(row.value.gross)} (net ${formatPrice(
              row.value.net,
            )} + tax ${formatPrice(row.value.originalTax)})`
          : row.kind === "SESSIONS"
            ? "No purchase valuation evidence; sessions counted, value not claimed."
            : "Credit is its own balance, not part of package value."}
      </p>
      {row.payments.length ? (
        <div className="text-sm">
          <h4 className="mt-2 font-bold">Payments</h4>
          <ul aria-label={`Payments for ${row.name}`}>
            {row.payments.map((payment) => (
              <li key={payment.id}>
                {formatDate(payment.occurredAt)} · {formatPrice(centsToMoney(payment.grossCents))}{" "}
                gross · {formatPrice(centsToMoney(payment.netCents))} net ·{" "}
                {formatPrice(centsToMoney(payment.taxCents))} GST
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {row.usage.length ? (
        <div className="text-sm">
          <h4 className="mt-2 font-bold">Usage</h4>
          <ul aria-label={`Usage for ${row.name}`}>
            {row.usage.map((draw) => (
              <li key={draw.id}>
                {formatDate(draw.usedAt)} ·{" "}
                {draw.amount ? formatPrice(draw.amount) : `${draw.quantity} session`}
                {draw.quantity > 1 && !draw.amount ? "s" : ""}
                {draw.revertedAt ? ` · reversed ${formatDate(draw.revertedAt)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {row.missingEvidence.length ? (
        <p className="text-sm text-ink-muted">
          Missing evidence: {row.missingEvidence.join(", ")}.
        </p>
      ) : null}
    </li>
  );
}
