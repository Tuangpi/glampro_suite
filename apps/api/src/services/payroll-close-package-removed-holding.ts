import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { loadSaleVoidCashConfirmation } from "./sale-void-cash.js";
import { loadSaleVoidPurchaseHoldings } from "./sale-void-purchase-evidence.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const rowSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  customerId: z.string().min(1),
  packageId: z.string().min(1),
  saleLineId: z.string().min(1),
  quantity: z.number().int().positive(),
  quantityRemaining: z.number().int().positive(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  payrollAvailableOrdinals: z.array(
    z.object({ first: z.number().int().positive(), last: z.number().int().positive() }),
  ),
  payrollPurchaseSnapshot: z.unknown().refine((value) => value !== undefined && value !== null),
  redemptionRules: z.unknown().refine((value) => value !== undefined && value !== null),
});

/** Revive only the actual deleted row, bound to the independently verified cash
 * confirmation and void snapshot. Catalogue data is never a substitute. */
export async function findPackageHoldingRemovedByPurchaseVoid(
  tx: PayrollCloseTransaction,
  tenantId: string,
  holdingId: string,
) {
  const purchases = await tx.packagePurchaseSnapshot.findMany({ where: { tenantId, holdingId } });
  if (purchases.length !== 1) return null;
  const cash = await loadSaleVoidCashConfirmation(tx, tenantId, purchases[0].saleId);
  const preserved = await loadSaleVoidPurchaseHoldings(
    tx,
    tenantId,
    purchases[0].saleId,
    cash.confirmation,
  );
  const packages = preserved.snapshot.packages.map((raw) => rowSchema.safeParse(raw));
  if (packages.some((row) => !row.success)) return null;
  const rows = packages.map((row) => {
    if (!row.success) throw new Error("Invalid removed package holding");
    const value = row.data;
    return {
      ...value,
      expiresAt: value.expiresAt === null ? null : new Date(value.expiresAt),
      createdAt: new Date(value.createdAt),
      updatedAt: new Date(value.updatedAt),
      payrollPurchaseSnapshot: value.payrollPurchaseSnapshot as Prisma.JsonValue,
      redemptionRules: value.redemptionRules as Prisma.JsonValue,
    };
  });
  const holding = rows.find((row) => row.id === holdingId);
  return holding ? { holding, packages: rows, cashConfirmation: cash.confirmation } : null;
}
