import { z } from "zod";
import { conflict, forbidden } from "../lib/http-error.js";
import { currentScope } from "../lib/tenant-context.js";
import { payrollInputHash } from "./payroll-close-state.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const action = "sale.void.cash-disposition";
const confirmationSchema = z.object({
  version: z.literal(1),
  cashDisposition: z.literal("NO_MOVEMENT"),
  actorId: z.string().min(1),
  actorRole: z.enum(["SUPER_ADMIN", "MANAGER"]),
  reason: z.string().trim().min(3).max(500),
  voidedAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  operationalHash: z.string().regex(/^[a-f0-9]{64}$/),
  purchaseHoldingHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

/** Bind the attestation to independent post-void operational records, not payroll
 * bases. Stable ID order and JSON normalization preserve dates/decimals/bigints. */
async function operationalEvidence(tx: PayrollCloseTransaction, tenantId: string, saleId: string) {
  const [sale, payments, redemptions, collections, outstanding, refunds] = await Promise.all([
    tx.sale.findFirst({
      where: { tenantId, id: saleId },
      include: { lines: { orderBy: { id: "asc" } } },
    }),
    tx.salePayment.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.customerRedemption.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.commissionCollection.findMany({
      where: { tenantId, saleId },
      include: { allocations: { orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    }),
    tx.customerOutstandingPayment.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
    tx.saleRefund.findMany({ where: { tenantId, saleId }, orderBy: { id: "asc" } }),
  ]);
  if (
    !sale ||
    sale.tenantId !== tenantId ||
    sale.status !== "VOID" ||
    !sale.voidedAt ||
    !sale.voidedById ||
    !sale.voidReason ||
    outstanding.length ||
    refunds.length
  )
    throw conflict("Authoritative payroll inputs unavailable: SALE_VOID_CASH_UNCONFIRMED.");
  // Concurrent retry serialization may touch updatedAt on an already-VOID row.
  // That bookkeeping timestamp is not a change to the attested money operation.
  const { updatedAt: _updatedAt, ...saleEvidence } = sale;
  const evidence = JSON.parse(
    JSON.stringify(
      { sale: saleEvidence, payments, redemptions, collections, outstanding, refunds },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    ),
  );
  return { sale, evidence, hash: payrollInputHash(evidence) };
}

/** Called only within the successful void transaction. Retries never add or amend
 * historical attestations; missing legacy cash disposition is not backfilled. */
export async function recordSaleVoidCashConfirmation(
  tx: PayrollCloseTransaction,
  tenantId: string,
  saleId: string,
  actorId: string,
  purchaseHoldingHash?: string,
) {
  const scope = currentScope();
  if (scope?.kind !== "tenant" || scope.tenantId !== tenantId || scope.actorId !== actorId)
    throw forbidden("Sale void cash confirmation requires the authenticated actor.");
  const actor = await tx.user.findFirst({ where: { tenantId, id: actorId, disabled: false } });
  if (
    !actor ||
    !["MANAGER", "SUPER_ADMIN"].includes(actor.globalRole) ||
    (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
  )
    throw forbidden("Sale void cash confirmation requires an authorized manager.");
  const operational = await operationalEvidence(tx, tenantId, saleId);
  if (operational.sale.voidedById !== actorId)
    throw conflict("Sale void cash confirmation actor does not match.");
  const metadata = confirmationSchema.parse({
    version: 1,
    cashDisposition: "NO_MOVEMENT",
    actorId,
    actorRole: actor.globalRole,
    reason: operational.sale.voidReason,
    voidedAt: operational.sale.voidedAt!.toISOString(),
    recordedAt: new Date().toISOString(),
    operationalHash: operational.hash,
    ...(purchaseHoldingHash ? { purchaseHoldingHash } : {}),
  });
  await tx.auditLog.create({
    data: { tenantId, action, targetType: "Sale", targetId: saleId, metadata },
  });
}

export async function loadSaleVoidCashConfirmation(
  tx: PayrollCloseTransaction,
  tenantId: string,
  saleId: string,
) {
  const [operational, audits] = await Promise.all([
    operationalEvidence(tx, tenantId, saleId),
    tx.auditLog.findMany({
      where: { tenantId, action, targetType: "Sale", targetId: saleId },
      orderBy: { id: "asc" },
    }),
  ]);
  const parsed = confirmationSchema.safeParse(audits[0]?.metadata);
  if (
    audits.length !== 1 ||
    !parsed.success ||
    audits[0].tenantId !== tenantId ||
    audits[0].action !== action ||
    audits[0].targetType !== "Sale" ||
    audits[0].targetId !== saleId ||
    parsed.data.operationalHash !== operational.hash ||
    parsed.data.actorId !== operational.sale.voidedById ||
    parsed.data.reason !== operational.sale.voidReason ||
    parsed.data.voidedAt !== operational.sale.voidedAt!.toISOString() ||
    parsed.data.recordedAt < parsed.data.voidedAt
  )
    throw conflict("Authoritative payroll inputs unavailable: SALE_VOID_CASH_UNCONFIRMED.");
  return {
    audit: { ...audits[0], createdAt: audits[0].createdAt.toISOString() },
    confirmation: parsed.data,
    operational: operational.evidence,
  };
}
