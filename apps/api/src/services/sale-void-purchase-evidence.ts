import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { conflict, forbidden } from "../lib/http-error.js";
import { currentScope } from "../lib/tenant-context.js";
import { packagePurchaseValue } from "../lib/package-valuation.js";
import { verifyPayrollPackagePurchase } from "./payroll-close-package-purchase.js";
import { verifyPayrollValuePurchase } from "./payroll-close-value-purchase.js";
import { payrollInputHash } from "./payroll-close-state.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

/** Audit action that carries the pre-deletion purchase holdings snapshot. */
export const SALE_VOID_PURCHASE_HOLDINGS_ACTION = "sale.void.purchase-holdings";
const action = SALE_VOID_PURCHASE_HOLDINGS_ACTION;
const id = z.string().min(1);
const money = z.string().regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/);
const holding = z
  .object({
    id,
    tenantId: id,
    saleLineId: id,
    customerId: id,
    payrollPurchaseSnapshot: z.unknown().refine((value) => value !== undefined && value !== null),
  })
  .passthrough();
const snapshotSchema = z.object({
  version: z.literal(1),
  tenantId: id,
  saleId: id,
  actorId: id,
  reason: z.string().trim().min(3),
  voidedAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  packages: z.array(
    holding.extend({
      packageId: id,
      quantity: z.number().int().positive(),
      quantityRemaining: z.number().int().positive(),
    }),
  ),
  credits: z.array(
    holding.extend({
      valuePackageId: id,
      amount: money,
      amountRemaining: money,
      familyId: z.null(),
      sharedFamilyId: z.null(),
    }),
  ),
});
const fail = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: PURCHASE_VOID_HOLDINGS_UNCONFIRMED.");
};
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Prospective only. Called under the void transaction's prepaid lock after the
 * sale becomes VOID, before deletion. Never backfill from captures or catalogue. */
export async function recordSaleVoidPurchaseHoldings(
  tx: PayrollCloseTransaction,
  tenantId: string,
  saleId: string,
  actorId: string,
) {
  const scope = currentScope();
  // Salon scope only. The void writer takes the actor as a parameter and stamps it on the
  // sale, so `sale.voidedById === actorId` below is what ties this snapshot to its voider;
  // comparing against the session actor again would refuse voids the writer accepts.
  if (scope?.kind !== "tenant" || scope.tenantId !== tenantId)
    throw forbidden("Purchase void evidence requires the authenticated salon scope.");
  const sale = await tx.sale.findFirst({
    where: { tenantId, id: saleId },
    include: { lines: true },
  });
  if (
    !sale ||
    sale.tenantId !== tenantId ||
    sale.status !== "VOID" ||
    sale.voidedById !== actorId ||
    !sale.voidedAt ||
    !sale.voidReason
  )
    return fail();
  const purchaseLines = sale.lines.filter((line) =>
    ["PACKAGE", "VALUE_PACKAGE"].includes(line.itemType),
  );
  if (!purchaseLines.length) return undefined;
  if (purchaseLines.some((line) => line.tenantId !== tenantId || line.saleId !== saleId))
    return fail();
  const lineIds = purchaseLines.map((line) => line.id);
  const [packages, credits] = await Promise.all([
    tx.customerPackageHolding.findMany({
      where: { tenantId, saleLineId: { in: lineIds } },
      orderBy: { id: "asc" },
    }),
    tx.customerValuePackageHolding.findMany({
      where: { tenantId, saleLineId: { in: lineIds } },
      orderBy: { id: "asc" },
    }),
  ]);
  // Capture operational facts without introducing new payroll eligibility gates
  // into the existing void workflow. Legacy/malformed snapshots remain unloadable.
  const snapshot = json({
    version: 1,
    tenantId,
    saleId,
    actorId,
    reason: sale.voidReason,
    voidedAt: sale.voidedAt.toISOString(),
    recordedAt: new Date().toISOString(),
    packages,
    credits,
  });
  const hash = payrollInputHash(snapshot);
  await tx.auditLog.create({
    data: {
      tenantId,
      action,
      targetType: "Sale",
      targetId: saleId,
      metadata: { snapshot, hash } as Prisma.InputJsonObject,
    },
  });
  return hash;
}

/** Verifies preserved original purchase inputs and deletion, NOT grant/removal
 * journals, collection inventory or payroll reversals. Those remain loader gates. */
export async function loadSaleVoidPurchaseHoldings(
  tx: PayrollCloseTransaction,
  tenantId: string,
  saleId: string,
  confirmation: {
    actorId: string;
    reason: string;
    voidedAt: string;
    recordedAt: string;
    purchaseHoldingHash?: string;
  },
) {
  if (!confirmation.purchaseHoldingHash) return fail();
  const [sale, audits, packages, credits] = await Promise.all([
    tx.sale.findFirst({ where: { tenantId, id: saleId }, include: { lines: true } }),
    tx.auditLog.findMany({
      where: { tenantId, action, targetType: "Sale", targetId: saleId },
      orderBy: { id: "asc" },
    }),
    tx.customerPackageHolding.findMany({ where: { tenantId, saleLine: { saleId } } }),
    tx.customerValuePackageHolding.findMany({ where: { tenantId, saleLine: { saleId } } }),
  ]);
  const metadata = z
    .object({ snapshot: z.unknown(), hash: z.string() })
    .safeParse(audits[0]?.metadata);
  if (
    !sale ||
    sale.status !== "VOID" ||
    sale.tenantId !== tenantId ||
    sale.voidedById !== confirmation.actorId ||
    sale.voidReason !== confirmation.reason ||
    sale.voidedAt?.toISOString() !== confirmation.voidedAt ||
    audits.length !== 1 ||
    audits[0].tenantId !== tenantId ||
    audits[0].action !== action ||
    audits[0].targetType !== "Sale" ||
    audits[0].targetId !== saleId ||
    packages.length ||
    credits.length ||
    !metadata.success ||
    metadata.data.hash !== confirmation.purchaseHoldingHash ||
    payrollInputHash(metadata.data.snapshot) !== metadata.data.hash
  )
    return fail();
  const parsed = snapshotSchema.safeParse(metadata.data.snapshot);
  if (!parsed.success) return fail();
  const snapshot = parsed.data;
  const rows = [...snapshot.packages, ...snapshot.credits];
  const lines = sale.lines.filter((line) => ["PACKAGE", "VALUE_PACKAGE"].includes(line.itemType));
  if (
    snapshot.tenantId !== tenantId ||
    snapshot.saleId !== saleId ||
    snapshot.actorId !== confirmation.actorId ||
    snapshot.reason !== confirmation.reason ||
    snapshot.voidedAt !== confirmation.voidedAt ||
    snapshot.recordedAt < snapshot.voidedAt ||
    snapshot.recordedAt > confirmation.recordedAt ||
    !lines.length ||
    new Set(lines.map((line) => line.id)).size !== lines.length ||
    lines.some((line) => line.tenantId !== tenantId || line.saleId !== saleId) ||
    rows.length !== lines.length ||
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    rows.some(
      (row) =>
        row.tenantId !== tenantId ||
        row.customerId !== sale.customerId ||
        !lines.some((line) => line.id === row.saleLineId),
    )
  )
    return fail();
  for (const line of lines) {
    if (line.itemType === "PACKAGE") {
      const originals = snapshot.packages.filter((row) => row.saleLineId === line.id);
      if (originals.length !== 1 || originals[0].quantityRemaining !== originals[0].quantity)
        return fail();
      verifyPayrollPackagePurchase(originals, line, sale, tenantId);
    } else {
      const originals = snapshot.credits
        .filter((row) => row.saleLineId === line.id)
        .map((row) => ({
          ...row,
          amount: new Prisma.Decimal(row.amount),
          amountRemaining: new Prisma.Decimal(row.amountRemaining),
        }));
      if (originals.length !== 1 || !originals[0].amount.equals(originals[0].amountRemaining))
        return fail();
      verifyPayrollValuePurchase(
        originals,
        line,
        tenantId,
        packagePurchaseValue(
          line.lineTotal.toFixed(2),
          line.voucherDiscountAmount.toFixed(2),
          line.taxAmount.toFixed(2),
        ).netCents,
      );
    }
  }
  return { snapshot, hash: metadata.data.hash, auditId: audits[0].id };
}
