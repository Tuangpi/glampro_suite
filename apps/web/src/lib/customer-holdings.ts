/**
 * Reading a customer's holdings (CP-008 f2 · N8).
 *
 * `GET /customers/:id/holdings` answers both ledgers — sessions and money — in one
 * list (`customerHoldingSchema`). The till's package panel and the tender sheet both
 * read it, so the small decisions about what a row *means* live here rather than in a
 * component: which services a package funds, whether its expiry has passed, the order
 * a cashier spends in, and how a covered service becomes a cart line.
 */
import type { CustomerHolding, SaleItem, ServiceSummary } from "@glampro_suite/shared";

/** A package's funded services, whichever shape the holding was bought in. */
export function coveredServiceIds(
  holding: Pick<CustomerHolding, "serviceIds" | "serviceSet">,
): string[] {
  const ids =
    holding.serviceSet && holding.serviceSet.length > 0
      ? holding.serviceSet.map((requirement) => requirement.serviceId)
      : holding.serviceIds;
  return [...new Set(ids)];
}

/**
 * The order a cashier spends in: the soonest expiry first, no-expiry last.
 *
 * The server's own spending order breaks an expiry tie on the purchase date, but the
 * holdings wire carries no purchase date (only `purchaseSaleId`), so this list falls
 * back to the name and then the id — deterministic, and honest about what it knows.
 *
 * `Date.parse` on an unparseable value is `NaN`, which would make the comparator
 * inconsistent, so anything that is not a real date sorts with the no-expiry rows.
 */
export function sortHoldings(holdings: readonly CustomerHolding[]): CustomerHolding[] {
  function expiryRank(holding: CustomerHolding): number {
    const parsed = holding.expiresAt === null ? Number.NaN : Date.parse(holding.expiresAt);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }

  return [...holdings].sort((left, right) => {
    const byExpiry = expiryRank(left) - expiryRank(right);
    if (Number.isFinite(byExpiry) && byExpiry !== 0) return byExpiry < 0 ? -1 : 1;
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    return left.id.localeCompare(right.id);
  });
}

/** Whether a holding's expiry has passed — `null` never expires. */
export function isExpired(expiresAt: string | null, now = Date.now()): boolean {
  if (expiresAt === null) return false;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) && parsed <= now;
}

/**
 * One catalogue service as the cart holds it.
 *
 * The till's search returns this shape for a service; a package's covered service is
 * read by id (`useCartServices`), so both have to become the same `SaleItem` here —
 * `addCartLine` reads only the name and the two prices, and the server re-prices from
 * the catalogue regardless.
 */
export function serviceSaleItem(service: ServiceSummary): SaleItem {
  return {
    kind: "SERVICE",
    id: service.id,
    name: service.name,
    price: service.nonmemberPrice,
    memberPrice: service.memberPrice,
    points: service.points,
    durationMinutes: service.durationMinutes,
  };
}
