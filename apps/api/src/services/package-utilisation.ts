import { prisma } from "../lib/prisma.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { forbidden } from "../lib/http-error.js";
import { Prisma } from "../../generated/prisma/client.js";
import { readPayrollPackagePurchase } from "@glampro_suite/shared";
import { z } from "zod";

/** Match each original grant to its completed sale line, never current catalogue data. */
export function soldSessionEvidence(
  line: { id: string; saleId: string; itemId: string },
  holdings: { saleLineId: string | null; payrollPurchaseSnapshot: unknown }[],
  snapshots: { saleLineId: string; saleId: string; grantedSessions: number }[],
): number | null {
  const captured = snapshots.find(
    (row) => row.saleLineId === line.id && row.saleId === line.saleId,
  );
  if (captured) return captured.grantedSessions;
  const holding = holdings.find((row) => row.saleLineId === line.id);
  if (!holding?.payrollPurchaseSnapshot) return null;
  try {
    const purchase = readPayrollPackagePurchase(holding.payrollPurchaseSnapshot);
    return purchase.saleLineId === line.id &&
      purchase.saleId === line.saleId &&
      purchase.packageId === line.itemId
      ? purchase.grantedSessions
      : null;
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      (error instanceof Error &&
        [
          "Package purchase snapshot economics are inconsistent.",
          "Package purchase net and GST must equal gross consideration.",
        ].includes(error.message))
    )
      return null;
    throw error;
  }
}

/** Lifetime operational counts, not money or a conservation equation. A package
 * sold is a pack; redeemed and expired are sessions. Never subtract one from another. */
export async function packageUtilisation() {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId) throw forbidden();
  if (currentOutletId()) throw forbidden("Package utilisation requires a company-wide view.");
  return prisma.$transaction(
    async (tx) => {
      const actor = await tx.user.findFirst({
        where: { id: scope.actorId, disabled: false },
        select: { globalRole: true },
      });
      if (!actor || !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole)) throw forbidden();
      const asOf = new Date();
      const sold = await tx.saleLine.groupBy({
        by: ["itemId"],
        where: { itemType: "PACKAGE", sale: { status: "COMPLETED" } },
        _sum: { quantity: true },
      });
      const lines = await tx.saleLine.findMany({
        where: { itemType: "PACKAGE", sale: { status: "COMPLETED" } },
        select: { id: true, saleId: true, itemId: true },
      });
      const holdings = await tx.customerPackageHolding.findMany({
        select: { saleLineId: true, payrollPurchaseSnapshot: true },
      });
      const snapshots = await tx.packagePurchaseSnapshot.findMany({
        select: { saleLineId: true, saleId: true, grantedSessions: true },
      });
      const sessionTotals = new Map<string, { known: number; unavailable: number }>();
      for (const line of lines) {
        const total = sessionTotals.get(line.itemId) ?? { known: 0, unavailable: 0 };
        const sessions = soldSessionEvidence(line, holdings, snapshots);
        if (sessions === null) total.unavailable++;
        else total.known += sessions;
        sessionTotals.set(line.itemId, total);
      }
      const redeemed = await tx.customerRedemption.groupBy({
        by: ["itemId"],
        where: { itemType: "PACKAGE", revertedAt: null },
        _sum: { quantity: true },
      });
      const expired = await tx.customerPackageHolding.groupBy({
        by: ["packageId"],
        where: { expiresAt: { lte: asOf }, quantityRemaining: { gt: 0 } },
        _sum: { quantityRemaining: true },
      });
      const ids = [
        ...new Set([
          ...sold.map((row) => row.itemId),
          ...redeemed.map((row) => row.itemId),
          ...expired.map((row) => row.packageId),
        ]),
      ];
      const packages = await tx.package.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      return {
        asOf: asOf.toISOString(),
        rows: ids.sort().map((id) => ({
          id,
          name: packages.find((row) => row.id === id)?.name ?? "Archived / unavailable package",
          packsSold: sold.find((row) => row.itemId === id)?._sum.quantity ?? 0,
          sessionsSold: sessionTotals.get(id)?.unavailable
            ? null
            : (sessionTotals.get(id)?.known ?? 0),
          knownSessionsSold: sessionTotals.get(id)?.known ?? 0,
          unavailableSoldLines: sessionTotals.get(id)?.unavailable ?? 0,
          sessionsRedeemed: redeemed.find((row) => row.itemId === id)?._sum.quantity ?? 0,
          sessionsExpiredUnused:
            expired.find((row) => row.packageId === id)?._sum.quantityRemaining ?? 0,
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
