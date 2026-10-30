import { conflict, forbidden } from "../lib/http-error.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { loadPayrollPackageRedemptionHistory } from "./payroll-close-redemption-loader.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const unavailable = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: SALE_PACKAGE_COVERAGE_UNCONFIRMED.");
};
// Prisma records contain Dates/Decimals. Normalize their explicit JSON forms
// before using the close-state canonical hash, which deliberately accepts JSON only.
const recordHash = (value: unknown) => payrollInputHash(JSON.parse(JSON.stringify(value)));

/** Server-owned cross-holding coverage, not a public request-record verifier.
 * Complete sale inventory and every involved holding's history share the tenant
 * source lock. No current catalogue, inferred tender coverage or silent deduping.
 * Supports verified correction chains; value spending and voids remain blocked.
 */
export async function loadPayrollSalePackageCoverage(tx: PayrollCloseTransaction, saleId: string) {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId())
    throw forbidden("Package payroll coverage requires a salon-wide authenticated actor.");
  const tenantId = scope.tenantId;
  await lockCommissionConfiguration(tx, tenantId);
  const actor = await tx.user.findFirst({
    where: { tenantId, id: scope.actorId, disabled: false },
  });
  if (
    !actor ||
    !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole) ||
    (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
  )
    throw forbidden("Package payroll coverage is not permitted.");
  const [sale, redemptions, events, snapshots, refunds] = await Promise.all([
    tx.sale.findFirst({ where: { tenantId, id: saleId }, include: { lines: true } }),
    // All item kinds and reverted rows matter: filtering to packages hides unsupported usage.
    tx.customerRedemption.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.payrollSourceEvent.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.commissionRedemptionSnapshot.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    tx.saleRefund.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
  ]);
  if (
    !sale ||
    sale.id !== saleId ||
    sale.tenantId !== tenantId ||
    sale.status !== "COMPLETED" ||
    sale.collectionCurrency !== "SGD" ||
    !sale.outletId ||
    refunds.length ||
    new Set(sale.lines.map((row) => row.id)).size !== sale.lines.length ||
    sale.lines.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        !Number.isSafeInteger(row.quantity) ||
        row.quantity <= 0,
    ) ||
    new Set(redemptions.map((row) => row.id)).size !== redemptions.length ||
    redemptions.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        row.customerId !== sale.customerId ||
        row.itemType !== "PACKAGE" ||
        !row.holdingId ||
        row.revertedAt !== null,
    ) ||
    events.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.saleId !== saleId ||
        !["SALE_LINE", "COLLECTION", "REDEMPTION", "CORRECTION", "REVERSAL"].includes(
          row.sourceType,
        ),
    ) ||
    snapshots.some((row) => row.tenantId !== tenantId)
  )
    return unavailable();
  const captures = events.filter((row) => row.sourceType === "REDEMPTION");
  const ids = new Set(redemptions.map((row) => row.id));
  if (
    captures.length !== redemptions.length ||
    new Set(captures.map((row) => row.sourceId)).size !== captures.length ||
    captures.some((row) => !ids.has(row.sourceId)) ||
    snapshots.filter((row) => ids.has(row.redemptionId) && row.eventType === "CAPTURE").length !==
      redemptions.length
  )
    return unavailable();
  const histories = [];
  for (const holdingId of [...new Set(redemptions.map((row) => row.holdingId!))].sort())
    histories.push(await loadPayrollPackageRedemptionHistory(tx, holdingId));
  const coverage = new Map<string, number>();
  const reconciled = new Set<string>();
  for (const history of histories) {
    const holdingId = history.evidence.holding.id;
    const inventory = redemptions.filter((row) => row.holdingId === holdingId);
    const historyRows = history.evidence.redemptions.filter((row) => row.saleId === saleId);
    if (
      inventory.length !== historyRows.length ||
      historyRows.some(
        (row) => !inventory.some((candidate) => recordHash(candidate) === recordHash(row)),
      )
    )
      return unavailable();
    for (const redemption of inventory) {
      const verified = history.verified.redemptions.find(
        (row) => row.redemptionId === redemption.id,
      );
      const source = history.evidence.related.find(
        (row) => row.sourceType === "REDEMPTION" && row.sourceId === redemption.id,
      );
      const capture = captures.find((row) => row.sourceId === redemption.id);
      const usage = history.evidence.usages.find((row) => row.id === saleId);
      if (
        !verified ||
        !source ||
        !capture ||
        !usage ||
        reconciled.has(redemption.id) ||
        recordHash(source) !== recordHash(capture) ||
        recordHash(usage) !== recordHash(sale)
      )
        return unavailable();
      reconciled.add(redemption.id);
      for (const part of verified.coverage) {
        const line = sale.lines.find((row) => row.id === part.saleLineId);
        const quantity = (coverage.get(part.saleLineId) ?? 0) + part.quantity;
        if (
          !line ||
          line.itemType !== "SERVICE" ||
          line.itemId !== part.serviceId ||
          !Number.isSafeInteger(quantity) ||
          quantity > line.quantity
        )
          return unavailable();
        coverage.set(line.id, quantity);
      }
    }
  }
  if (reconciled.size !== redemptions.length) return unavailable();
  const verifiedEvents = new Map(
    histories.flatMap((history) =>
      [...history.evidence.related, ...history.evidence.correctionReversals].map(
        (event) => [event.id, event] as const,
      ),
    ),
  );
  if (
    events.some(
      (event) =>
        ["CORRECTION", "REVERSAL"].includes(event.sourceType) &&
        (!verifiedEvents.has(event.id) ||
          recordHash(verifiedEvents.get(event.id)) !== recordHash(event)),
    )
  )
    return unavailable();
  return {
    lines: sale.lines
      .map((line) => ({
        saleLineId: line.id,
        coveredQuantity: coverage.get(line.id) ?? 0,
        remainingQuantity: line.quantity - (coverage.get(line.id) ?? 0),
      }))
      .sort((a, b) => a.saleLineId.localeCompare(b.saleLineId)),
    evidence: { sale, redemptions, captures, histories },
  };
}
