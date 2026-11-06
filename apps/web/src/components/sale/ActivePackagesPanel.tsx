/**
 * What the attached customer can still spend — CP-008 (f2) · N8.
 *
 * The till's copy of the customer screen's packages tab: `GET /customers/:id/holdings`
 * answers both ledgers, so the cashier sees the sessions and the credit a customer
 * holds *before* ringing anything up rather than discovering them at the tender step.
 * The sheet (`PaymentDialog`) remains the only thing that decides **how much** a
 * holding pays — it recomputes coverage with `packageCoverage` and the server
 * recomputes it again — so this panel is a shortcut into that flow, never a second
 * decision-maker. A row's action rings up what the package is for and opens the sheet
 * with that holding already chosen.
 *
 * Three rules the panel states rather than lets the server discover:
 *
 * 1. **Expiry.** A holding past `expiresAt` cannot pay, so the row says `Expired` and
 *    offers nothing. Ordering puts the soonest expiry first and no-expiry last, the
 *    order a cashier wants to spend in. The wire carries no purchase date (only
 *    `purchaseSaleId`), so this list cannot mirror the server's second tiebreak and
 *    falls back to the name and then the id — stable, and honest about what it knows.
 * 2. **Unpaid sessions.** `paidSessionsRemaining` is how many remaining sessions have
 *    payment evidence (the server's own `used + quantity <= paid` rule). When it is
 *    short the redemption needs a manager PIN — `payroll-package-session.ts` refuses
 *    with `PACKAGE_UNPAID_SESSIONS` otherwise — so the row says so and still opens the
 *    sheet, because the override is the cashier's job to fetch, not ours to hide.
 *    `null`/absent means the purchase snapshot is missing: "payment evidence
 *    unavailable", the same words the sheet's holding picker uses.
 * 3. **A service that is no longer sold cannot be redeemed**, so a package whose every
 *    covered service is off sale shows no action: the sale would be refused at post
 *    time, and offering a button that cannot work is worse than offering none.
 */
import { useState } from "react";

import type { CustomerHolding, SaleItem, ServiceSummary } from "@glampro_suite/shared";

import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Select from "@/components/ui/Select";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useCustomerHoldings } from "@/hooks/useCustomers";
import { useCartServices } from "@/hooks/useServices";
import { getErrorMessage } from "@/lib/api";
import {
  coveredServiceIds,
  isExpired,
  serviceSaleItem,
  sortHoldings,
} from "@/lib/customer-holdings";
import { centsToPrice } from "@/lib/money";

export interface ActivePackagesPanelProps {
  /** The customer attached to the sale, or `null` for a walk-in. */
  customerId: string | null;
  /** The till may not write (suspended salon, a hold in flight, the sheet is open). */
  disabled: boolean;
  /**
   * Spends one session, or pays with credit.
   *
   * The tender to start on is handed back rather than added here, so the panel stays a
   * view: the page owns the cart and the sheet, and `null` is credit — which pays
   * whatever the cart already owes and so adds no line.
   */
  onRedeem: (
    redemption: { method: "PACKAGE" | "PREPAID_CREDIT"; holdingId: string },
    item: SaleItem | null,
  ) => void;
}

function sessionsLabel(count: number): string {
  return `${count} session${count === 1 ? "" : "s"}`;
}

/** Cents a holding still owes on its purchase, `0` when it owes nothing. */
function balanceDueCents(holding: CustomerHolding): number {
  const value = holding.balanceDueCents;
  if (value === null || value === undefined) return 0;
  const cents = Number(value);
  return Number.isFinite(cents) && cents > 0 ? cents : 0;
}

export default function ActivePackagesPanel({
  customerId,
  disabled,
  onRedeem,
}: ActivePackagesPanelProps) {
  const { formatPrice, formatDate } = useSalonFormatting();
  const holdings = useCustomerHoldings(customerId);
  const available = holdings.data?.holdings ?? [];
  const packages = sortHoldings(available.filter((holding) => holding.kind === "PACKAGE"));
  const credits = sortHoldings(available.filter((holding) => holding.kind === "PREPAID_CREDIT"));

  // Every distinct service the packages fund, in a fixed order so the rows list them
  // the same way on each render and the resolved answers line up with the ids asked for.
  const coveredKey = [...new Set(packages.flatMap((holding) => coveredServiceIds(holding)))]
    .sort()
    .join(",");
  const coveredIds = coveredKey === "" ? [] : coveredKey.split(",");
  const services = useCartServices(coveredIds);
  const servicesLoading = services.some((query) => query.isPending);
  const serviceById = new Map(
    coveredIds.map((id, index) => [id, services[index]?.data ?? null] as const),
  );

  return (
    <Card
      title="Packages & credit"
      label="Packages & credit"
      description="What this customer can spend at this till."
    >
      {customerId === null ? (
        <p className="px-2 py-1 text-sm text-ink-muted">
          Attach a customer to see the packages and credit they can spend.
        </p>
      ) : holdings.isPending ? (
        <p aria-busy="true" className="px-2 py-1 text-sm text-ink-muted">
          Reading what the customer holds…
        </p>
      ) : holdings.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 px-2 py-1 text-sm">
          <p>{getErrorMessage(holdings.error)}</p>
          <Button variant="secondary" size="sm" onClick={() => void holdings.refetch()}>
            Retry
          </Button>
        </div>
      ) : packages.length === 0 && credits.length === 0 ? (
        <p className="px-2 py-1 text-sm text-ink-muted">
          This customer holds no packages or credit.
        </p>
      ) : (
        <ul aria-label="Packages and credit" className="flex flex-col gap-2 px-2 py-1">
          {packages.map((holding) => (
            <PackageRow
              key={holding.id}
              holding={holding}
              covered={coveredServiceIds(holding).map((id) => serviceById.get(id) ?? null)}
              loading={servicesLoading}
              disabled={disabled}
              formatDate={formatDate}
              formatPrice={formatPrice}
              onRedeem={onRedeem}
            />
          ))}
          {credits.map((holding) => (
            <li
              key={holding.id}
              className="flex flex-col gap-1 rounded-md border border-line-soft bg-surface p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                <p className="min-w-0 text-sm font-bold text-ink">{holding.name}</p>
                {isExpired(holding.expiresAt) ? <Badge variant="danger">Expired</Badge> : null}
              </div>
              <p className="text-sm text-ink-body">
                {formatPrice(holding.amountRemaining ?? "0.00")} left
              </p>
              <p className="text-xs text-ink-muted">
                {holding.expiresAt === null
                  ? "No expiry"
                  : `Expires ${formatDate(holding.expiresAt)}`}
              </p>
              {Number(holding.amountRemaining ?? "0") <= 0 ||
              isExpired(holding.expiresAt) ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-1 self-start"
                  disabled={disabled}
                  onClick={() =>
                    onRedeem({ method: "PREPAID_CREDIT", holdingId: holding.id }, null)
                  }
                >
                  Pay with credit
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface PackageRowProps {
  holding: CustomerHolding;
  /** One entry per service the package lists; `null` while it is not resolved. */
  covered: readonly (ServiceSummary | null)[];
  /** True while any covered service is still being read. */
  loading: boolean;
  disabled: boolean;
  formatDate: (value: string) => string;
  formatPrice: (value: string | number) => string;
  onRedeem: ActivePackagesPanelProps["onRedeem"];
}

/**
 * One package. The service picker only exists when the package covers more than one
 * sellable service — a single-service package redeems on its own with one click.
 */
function PackageRow({
  holding,
  covered,
  loading,
  disabled,
  formatDate,
  formatPrice,
  onRedeem,
}: PackageRowProps) {
  const [chosenServiceId, setChosenServiceId] = useState("");
  const expired = isExpired(holding.expiresAt);
  const sellable = covered.filter(
    (service): service is ServiceSummary => service !== null && service.status === "ACTIVE",
  );
  // Defaults to the first sellable service, so a one-line package needs no choice and
  // a multi-service one is postable without the cashier opening the picker.
  const chosen = sellable.find((service) => service.id === chosenServiceId) ?? sellable[0] ?? null;
  const outstanding = balanceDueCents(holding);
  const unpaidRemaining = Math.max(
    0,
    holding.quantityRemaining - (holding.paidSessionsRemaining ?? holding.quantityRemaining),
  );
  // Expiry and an empty count are already stated in the row, so neither needs an
  // action that could only be disabled: the sheet would refuse the tender anyway.
  const usable = !expired && holding.quantityRemaining > 0;

  return (
    <li className="flex flex-col gap-1 rounded-md border border-line-soft bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <p className="min-w-0 text-sm font-bold text-ink">{holding.name}</p>
        {expired ? (
          <Badge variant="danger">Expired</Badge>
        ) : holding.quantityRemaining === 0 ? (
          <Badge variant="neutral">Fully used</Badge>
        ) : null}
      </div>

      <p className="text-sm text-ink-body">
        {holding.quantityRemaining === 0
          ? "No sessions left"
          : `${sessionsLabel(holding.quantityRemaining)} left`}
      </p>

      {holding.paidSessionsRemaining === null || holding.paidSessionsRemaining === undefined ? (
        <p className="text-xs text-ink-muted">Payment evidence unavailable</p>
      ) : unpaidRemaining > 0 ? (
        <p className="text-xs text-warning">
          {unpaidRemaining} unpaid — a manager PIN is needed to redeem{" "}
          {unpaidRemaining === 1 ? "it" : "them"}.
        </p>
      ) : null}

      <p className="text-xs text-ink-muted">
        {holding.expiresAt === null ? "No expiry" : `Expires ${formatDate(holding.expiresAt)}`}
        {covered.length === 0
          ? ""
          : ` · covers ${covered.length === 1 ? "1 service" : `${covered.length} services`}`}
      </p>

      {outstanding > 0 ? (
        <p className="text-xs text-warning">
          Balance due {formatPrice(centsToPrice(outstanding))} — collecting it is a separate sale.
        </p>
      ) : null}

      {!usable ? null : covered.length === 0 ? (
        <p className="text-xs text-ink-muted">This package lists no covered service.</p>
      ) : covered.every((service) => service === null) && loading ? (
        <p className="text-xs text-ink-muted">Resolving covered services…</p>
      ) : sellable.length === 0 ? (
        <p className="text-xs text-ink-muted">
          None of its services is on sale today, so it cannot be redeemed here.
        </p>
      ) : (
        <div className="mt-1 flex flex-wrap items-end gap-2">
          {sellable.length > 1 ? (
            <Select
              label={`Service to redeem for ${holding.name}`}
              hideLabel
              value={chosen?.id ?? ""}
              options={sellable.map((service) => ({ value: service.id, label: service.name }))}
              disabled={disabled}
              onChange={(event) => setChosenServiceId(event.target.value)}
              className="min-w-0 flex-1"
            />
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => {
              if (chosen)
                onRedeem({ method: "PACKAGE", holdingId: holding.id }, serviceSaleItem(chosen));
            }}
          >
            Redeem 1
          </Button>
        </div>
      )}
    </li>
  );
}
