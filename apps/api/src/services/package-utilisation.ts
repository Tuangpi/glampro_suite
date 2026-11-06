import { prisma } from "../lib/prisma.js";
import { currentOutletId, currentScope } from "../lib/tenant-context.js";
import { forbidden } from "../lib/http-error.js";
import { Prisma } from "../../generated/prisma/client.js";

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
          sessionsRedeemed: redeemed.find((row) => row.itemId === id)?._sum.quantity ?? 0,
          sessionsExpiredUnused:
            expired.find((row) => row.packageId === id)?._sum.quantityRemaining ?? 0,
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
