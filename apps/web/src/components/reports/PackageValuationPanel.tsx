import type { PackageValuationReport } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { usePackageValuationReport } from "@/hooks/useReports";
import { getErrorMessage } from "@/lib/api";
import PackageValuationActivation from "./PackageValuationActivation";

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-surface-muted px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-base font-heavy text-ink">{value}</dd>
    </div>
  );
}

export default function PackageValuationPanel() {
  const report = usePackageValuationReport();
  const { formatDateTime, timeZone, locale } = useSalonFormatting();
  // Format whole units as bigint: company-wide totals must not lose cents to Number.
  const money = (value: string) => {
    const [whole = "0", cents = "00"] = value.split(".");
    return `SGD ${BigInt(whole).toLocaleString(locale)}.${cents}`;
  };
  const bucket = (label: string, value: PackageValuationReport["active"]) => (
    <section aria-label={label} className="space-y-2">
      <h4 className="font-bold">{label}</h4>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Figure label="Remaining purchase value (net)" value={money(value.net)} />
        <Figure label="Original purchase tax" value={money(value.originalTax)} />
        <Figure label="Gross purchase value" value={money(value.gross)} />
        <Figure
          label="Valued sessions"
          value={`${value.sessionsRemaining} across ${value.holdings} holdings`}
        />
      </dl>
    </section>
  );
  const data = report.data;
  return (
    <section aria-label="Remaining package purchase value">
      <Card
        title="Remaining package purchase value"
        description="Company-wide current snapshot across all outlets. Independent of the selected sales range and outlet."
        actions={
          <Button
            variant="secondary"
            loading={report.isFetching}
            onClick={() => void report.refetch()}
          >
            Refresh package value
          </Button>
        }
      >
        {report.isError ? (
          <p role="alert" className="text-sm text-danger-text">
            Package valuation is unavailable. No reconciled values are displayed:{" "}
            {getErrorMessage(report.error)}
          </p>
        ) : report.isPending || !data ? (
          <p role="status">Loading package valuation…</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              Package snapshot as of {formatDateTime(data.asOf)} ({timeZone}). Other report panels
              have their own snapshot times.
            </p>
            {data.activation ? (
              <>
                <details className="rounded-md border border-line p-3 text-sm text-ink-muted">
                  <summary className="cursor-pointer font-bold text-ink">
                    Valuation policy and audit details
                  </summary>
                  <p className="mt-3">
                    Policy {data.activation.policyVersion} · {data.activation.currency} · Valuation
                    started {formatDateTime(data.activation.activatedAt)}. Only verified purchases
                    recorded from activation are valued; no legacy backfill.
                  </p>
                  <p className="break-words text-sm text-ink-muted">
                    Immutable activation confirmation by {data.activation.actorId}:{" "}
                    {data.activation.reason}
                  </p>
                  <p className="mt-2">
                    Reconciled {data.reconciliation.purchases} purchase snapshots and{" "}
                    {data.reconciliation.movements} movements.
                  </p>
                </details>
                <div className="grid gap-4 lg:grid-cols-2">
                  {bucket("Active unused packages", data.active)}
                  {bucket("Expired unused packages", data.expired)}
                </div>
                <p className="text-sm text-ink-muted">
                  Expired value is separate and does not imply recognised revenue.
                </p>
              </>
            ) : (
              <div className="space-y-3">
                <p role="status">
                  Package valuation is not activated. Monetary package values are not available.
                  Existing holdings remain unvalued.
                </p>
                <PackageValuationActivation />
              </div>
            )}
            <section aria-label="Unvalued package holdings" className="space-y-2">
              <h4 className="font-bold">Unvalued package holdings</h4>
              <p className="text-sm text-ink-muted">
                Unknown purchase value is not zero and is excluded from monetary figures. Valuation
                is incomplete while unvalued holdings remain.
              </p>
              <dl className="grid gap-3 sm:grid-cols-2">
                <Figure
                  label="Unvalued active sessions"
                  value={`${data.unvalued.active.sessionsRemaining} across ${data.unvalued.active.holdings} holdings`}
                />
                <Figure
                  label="Unvalued expired sessions"
                  value={`${data.unvalued.expired.sessionsRemaining} across ${data.unvalued.expired.holdings} holdings`}
                />
              </dl>
            </section>
            {data.activation && (
              <section aria-label="Unpaid package purchase disclosure" className="space-y-2">
                <h4 className="font-bold">Purchases linked to unpaid source sales</h4>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Figure
                    label="Remaining valued holdings linked to debt"
                    value={`${data.unpaidPurchases.holdings} across ${data.unpaidPurchases.sales} sales`}
                  />
                  <Figure
                    label="Whole source-sale outstanding"
                    value={money(data.unpaidPurchases.sourceSaleOutstanding)}
                  />
                </dl>
                <p className="text-sm text-ink-muted">
                  Unpaid purchases retain their full contracted value. Outstanding amounts cover
                  whole source sales, may include other items, and are counted once per sale—not
                  allocated package cash or an amount to subtract from package value.
                </p>
              </section>
            )}
            <p className="text-sm text-ink-muted">
              Discounted contracted purchase consideration, not current catalogue price, cash
              received, statutory accounting liability or deferred revenue. Original purchase tax is
              shown separately; this does not calculate current GST. Package values are not added to
              prepaid credit, gift cards or receivables.
            </p>
          </div>
        )}
      </Card>
    </section>
  );
}
