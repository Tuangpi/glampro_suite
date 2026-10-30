import { z } from "zod";
import {
  readPayrollPackagePurchase,
  paidPayrollPackageSessions,
  payrollPackageSessionBase,
  allocatePayrollSplit,
  type CommissionShares,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden } from "../lib/http-error.js";
import {
  takePackageSessions,
  restorePackageSessions,
  normalizeSessionRanges,
} from "../lib/package-valuation.js";
import { verifyPassword } from "../lib/password.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export const payrollOrdinalSchema = z.array(
  z.strictObject({ first: z.number().int().positive(), last: z.number().int().positive() }),
);
export const payrollSessionEvidenceSchema = z.object({
  status: z.enum(["CAPTURED", "UNAVAILABLE"]),
  holdingId: z.string(),
  ordinals: payrollOrdinalSchema.nullable(),
  baseAmount: z.string().nullable(),
  bases: z.array(z.object({ staffId: z.string(), share: z.number().int(), amount: z.string() })),
  units: z.array(z.object({ staffId: z.string(), share: z.number().int(), amount: z.string() })),
  purchase: z.json().nullable(),
  missingEvidence: z.array(z.string()),
});

/** Source caller holds the salon prepaid lock and the holding lock. No valuation activation needed. */
export async function drawPayrollPackageSessions(
  tx: Transaction,
  holdingId: string,
  quantity: number,
  override?: { managerId: string; pin: string; reason: string },
  saleId?: string,
) {
  const holding = await tx.customerPackageHolding.findFirstOrThrow({ where: { id: holdingId } });
  if (
    await tx.payrollSourceEvent.findFirst({
      where: { sourceType: "PACKAGE_REFUND", sourceId: holdingId },
    })
  )
    throw conflict(
      "Refunded package sessions cannot be restored. Reconcile the refund through a reasoned correction.",
    );
  if (!holding.payrollPurchaseSnapshot || !holding.payrollAvailableOrdinals)
    return {
      ordinals: null,
      purchase: holding.payrollPurchaseSnapshot,
      missingEvidence: ["ORIGINAL_SESSION_ORDINALS"],
    };
  const purchase = readPayrollPackagePurchase(holding.payrollPurchaseSnapshot);
  const available = normalizeSessionRanges(
    purchase.grantedSessions,
    payrollOrdinalSchema.parse(holding.payrollAvailableOrdinals),
  );
  if (
    available.reduce((sum, row) => sum + row.last - row.first + 1, 0) !== holding.quantityRemaining
  )
    throw conflict("Package payroll ordinals do not reconcile with remaining sessions.");
  const collections = await tx.commissionCollectionAllocation.findMany({
    where: { saleLineId: purchase.saleLineId },
  });
  const collected = collections.reduce((sum, row) => sum + row.netCents, 0n);
  const used = purchase.grantedSessions - holding.quantityRemaining;
  const confirmedCollections = purchase.currency !== null;
  const paid = confirmedCollections ? paidPayrollPackageSessions(purchase, collected) : 0;
  if (used + quantity > paid) {
    if (!override)
      throw conflict(
        "Collect the package balance before redeeming unpaid sessions, or obtain manager PIN approval.",
        "PACKAGE_UNPAID_SESSIONS",
      );
    const manager = await tx.user.findFirst({ where: { id: override.managerId, disabled: false } });
    if (
      !manager ||
      manager.tenantId !== holding.tenantId ||
      !["SUPER_ADMIN", "MANAGER"].includes(manager.globalRole) ||
      !manager.posPinHash ||
      !(await verifyPassword(override.pin, manager.posPinHash))
    )
      throw forbidden("A valid enabled salon manager PIN is required.", "INVALID_MANAGER_PIN");
    const scope = currentScope();
    if (scope?.kind !== "tenant" || !scope.actorId || scope.tenantId !== holding.tenantId)
      throw forbidden("An authenticated operator is required.");
    const sale = saleId
      ? await tx.sale.findFirst({ where: { id: saleId, tenantId: scope.tenantId } })
      : null;
    if (!sale || sale.customerId !== holding.customerId || !override.reason.trim())
      throw conflict("A matching usage sale and reason are required for a package override.");
    await tx.auditLog.create({
      data: {
        tenantId: scope.tenantId,
        createdAt: new Date(),
        action: "package.unpaid-session.override",
        targetType: "CustomerPackageHolding",
        targetId: holdingId,
        metadata: {
          actorId: scope.actorId,
          managerId: manager.id,
          managerRole: manager.globalRole,
          saleId: sale.id,
          reason: override.reason,
          quantity,
          paidSessions: paid,
          usedSessions: used,
        },
      },
    });
  }
  const allocation = takePackageSessions(purchase.grantedSessions, available, quantity);
  await tx.customerPackageHolding.update({
    where: { id: holdingId },
    data: {
      payrollAvailableOrdinals: allocation.remaining.map(({ first, last }) => ({ first, last })),
    },
  });
  return { ordinals: allocation.allocated, purchase, missingEvidence: [] };
}

export function payrollSessionEvidence(
  holdingId: string,
  draw: {
    purchase: unknown;
    ordinals: { first: number; last: number }[] | null;
    missingEvidence: string[];
  },
  performers: CommissionShares | null,
) {
  const missingEvidence = [...draw.missingEvidence];
  if (!performers) missingEvidence.push("PERFORMERS");
  if (!draw.purchase || !draw.ordinals || !performers)
    return {
      status: "UNAVAILABLE" as const,
      holdingId,
      ordinals: draw.ordinals,
      purchase: z.json().parse(draw.purchase),
      missingEvidence,
      baseAmount: null,
      bases: [],
      units: [],
    };
  const purchase = readPayrollPackagePurchase(draw.purchase);
  missingEvidence.push(...purchase.missingEvidence);
  let ticks = 0n,
    quantity = 0;
  for (const range of draw.ordinals) {
    const base = payrollPackageSessionBase(purchase, range.first, range.last, performers);
    ticks += BigInt(base.baseAmount.replace(".", ""));
    quantity += range.last - range.first + 1;
  }
  const baseAmount = `${ticks / 10000n}.${(ticks % 10000n).toString().padStart(4, "0")}`;
  return {
    status: missingEvidence.length ? ("UNAVAILABLE" as const) : ("CAPTURED" as const),
    holdingId,
    ordinals: draw.ordinals,
    purchase,
    missingEvidence,
    baseAmount,
    bases: allocatePayrollSplit(baseAmount, performers),
    units: allocatePayrollSplit(`${quantity}.0000`, performers),
  };
}

export async function restorePayrollPackageSessions(
  tx: Transaction,
  redemptionId: string,
  holdingId: string,
) {
  if (
    await tx.payrollSourceEvent.findFirst({
      where: { sourceType: "PACKAGE_REFUND", sourceId: holdingId },
    })
  )
    throw conflict("Refunded package sessions cannot be restored without refund reconciliation.");
  const snapshot = await tx.commissionRedemptionSnapshot.findFirst({
    where: { redemptionId, eventType: "CAPTURE" },
  });
  const object = z
    .object({ payrollSession: payrollSessionEvidenceSchema.optional() })
    .parse(snapshot?.evidence ?? {});
  const evidence = object.payrollSession;
  if (!evidence?.ordinals) return;
  const holding = await tx.customerPackageHolding.findFirstOrThrow({ where: { id: holdingId } });
  const purchase = readPayrollPackagePurchase(holding.payrollPurchaseSnapshot);
  const restored = restorePackageSessions(
    purchase.grantedSessions,
    payrollOrdinalSchema.parse(holding.payrollAvailableOrdinals),
    evidence.ordinals,
  );
  await tx.customerPackageHolding.update({
    where: { id: holdingId },
    data: { payrollAvailableOrdinals: restored.map(({ first, last }) => ({ first, last })) },
  });
}
