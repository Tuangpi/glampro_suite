import { createHash } from "node:crypto";
import { z } from "zod";
import { commissionAttributionSchema } from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { badRequest, conflict, forbidden } from "../lib/http-error.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { allocateCollection } from "../lib/commission-collection.js";
import { packageMoneyToCents, packagePurchaseValue } from "../lib/package-valuation.js";
import { lockCommissionConfiguration } from "./commission.service.js";
import { resolveCommission } from "./commission-rules.js";
import { commissionAmount } from "./commission-ledger.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const cents = z.string().regex(/^[1-9]\d{0,11}$/);
export const captureCollectionSchema = z.strictObject({
  eventKey: z.string().min(8).max(128),
  sourceType: z.enum(["SALE_PAYMENT", "OUTSTANDING_PAYMENT"]),
  sourceId: z.string().min(1).max(128),
  saleId: z.string().min(1).max(128),
  // Trusted caller must supply evidenced sale currency, never a subscription currency.
  currency: z.string().regex(/^[A-Z]{3}$/),
  reason: z.string().trim().min(3).max(500),
  allocations: z
    .array(z.strictObject({ saleLineId: z.string().min(1), grossCents: cents }))
    .min(1)
    .max(500),
});
export type CaptureCollection = z.infer<typeof captureCollectionSchema>;

/**
 * Internal transactional seam used by POS and later collections. Callers authorize the source,
 * verify currency and settlement and use the same transaction as the money write.
 * Enter before configuration/holding locks, or after already taking the POS lock.
 * This captures candidate evidence only; it never posts EmployeeCommission.
 */
export async function captureCollectionEvidence(tx: Transaction, value: CaptureCollection) {
  const input = captureCollectionSchema.parse(value);
  input.allocations.sort((a, b) => a.saleLineId.localeCompare(b.saleLineId));
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId)
    throw forbidden("Collection evidence requires an authenticated salon actor.");
  const { tenantId, actorId } = scope;
  await lockPrepaid(tx, tenantId);
  await lockCommissionConfiguration(tx, tenantId);
  const actor = await tx.user.findFirst({ where: { id: actorId, disabled: false } });
  if (!actor) throw forbidden("Collection actor is no longer an enabled salon member.");
  const eventHash = createHash("sha256")
    .update(JSON.stringify({ ...input, actorId }))
    .digest("hex");
  const existing = await tx.commissionCollection.findFirst({
    where: {
      OR: [
        { eventKey: input.eventKey },
        { sourceType: input.sourceType, sourceId: input.sourceId },
      ],
    },
    include: { allocations: { orderBy: { saleLineId: "asc" } } },
  });
  if (existing) {
    if (existing.eventHash !== eventHash)
      throw conflict("Collection source or retry key already has different evidence.");
    return existing;
  }
  const sale = await tx.sale.findFirst({ where: { id: input.saleId }, include: { refund: true } });
  if (!sale || sale.status !== "COMPLETED" || sale.refund)
    throw badRequest("Collection evidence requires a completed unrefunded sale.");
  if (sale.collectionCurrency && sale.collectionCurrency !== input.currency)
    throw badRequest("Collection currency differs from the confirmed sale currency.");
  let sourceAmount: string;
  let occurredAt: Date;
  if (input.sourceType === "SALE_PAYMENT") {
    const source = await tx.salePayment.findFirst({
      where: { id: input.sourceId, saleId: sale.id },
    });
    if (
      !source ||
      ["PACKAGE", "PREPAID_CREDIT"].includes(source.method) ||
      source.sessionId !== null
    )
      throw badRequest(
        "Collection requires a non-credit recorded payment without unsettled gateway evidence.",
      );
    sourceAmount = source.amount.toFixed(2);
    occurredAt = source.createdAt;
  } else {
    const source = await tx.customerOutstandingPayment.findFirst({
      where: { id: input.sourceId, saleId: sale.id, customerId: sale.customerId ?? "" },
      include: { outstanding: true },
    });
    if (
      !source ||
      source.outstanding.tenantId !== tenantId ||
      source.outstanding.saleId !== sale.id ||
      source.outstanding.customerId !== source.customerId
    )
      throw badRequest("Outstanding collection does not belong to the original sale and customer.");
    sourceAmount = source.paidAmount.toFixed(2);
    occurredAt = source.paidAt;
  }
  const grossCents = packageMoneyToCents(sourceAmount);
  if (grossCents === 0n) throw badRequest("Collection requires a positive settled source amount.");
  const otherCurrency = await tx.commissionCollection.findFirst({
    where: { saleId: sale.id, currency: { not: input.currency } },
  });
  if (otherCurrency)
    throw conflict("Collection currency differs from original collection evidence.");
  const lines = await tx.saleLine.findMany({ where: { saleId: sale.id } });
  const prior = await tx.commissionCollectionAllocation.groupBy({
    by: ["saleLineId"],
    where: { saleLineId: { in: lines.map((line) => line.id) } },
    _sum: { grossCents: true },
  });
  const state = lines.map((line) => ({
    lineId: line.id,
    purchase: packagePurchaseValue(
      line.lineTotal.toFixed(2),
      line.voucherDiscountAmount.toFixed(2),
      line.taxAmount.toFixed(2),
    ),
    collectedGrossCents: prior.find((row) => row.saleLineId === line.id)?._sum.grossCents ?? 0n,
  }));
  const deltas = allocateCollection(
    grossCents,
    state,
    input.allocations.map((row) => ({
      lineId: row.saleLineId,
      grossCents: BigInt(row.grossCents),
    })),
  );
  const collection = await tx.commissionCollection.create({
    data: {
      tenantId,
      eventKey: input.eventKey,
      eventHash,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      saleId: sale.id,
      currency: input.currency,
      grossCents,
      occurredAt,
      actorId,
      reason: input.reason,
    },
  });
  for (const delta of deltas) {
    const line = lines.find((row) => row.id === delta.lineId)!;
    const original = state.find((row) => row.lineId === delta.lineId)!;
    const attribution =
      line.attribution === null ? null : commissionAttributionSchema.parse(line.attribution);
    const sellers = attribution?.sellers ?? null;
    const kind =
      line.itemType === "PACKAGE"
        ? "PACKAGE_SALE"
        : line.itemType === "VALUE_PACKAGE"
          ? "STORED_CREDIT_SALE"
          : null;
    const rules =
      kind && sellers
        ? await tx.commissionRule.findMany({
            where: {
              itemKind: kind,
              effectiveAt: { lte: occurredAt },
              OR: [{ staffId: null }, { staffId: { in: sellers.map((person) => person.staffId) } }],
            },
          })
        : [];
    const basis = `${delta.netCents / 100n}.${(delta.netCents % 100n).toString().padStart(2, "0")}`;
    const rates = [];
    for (const person of sellers ?? []) {
      // Departed sellers retain immutable identity; no reassignment to current cashier.
      if (!(await tx.user.findFirst({ where: { id: person.staffId } })))
        throw badRequest("Original seller evidence does not belong to this salon.");
      if (!kind) continue;
      const selected = resolveCommission(
        rules,
        {
          staffId: person.staffId,
          itemKind: kind,
          itemId: line.itemId,
          departmentId: null,
          legacyServiceRate: "0",
        },
        occurredAt,
      );
      const rate = new Prisma.Decimal(selected.rate).toFixed(2);
      rates.push({
        ...person,
        ...selected,
        rate,
        amount: commissionAmount(basis, rate, person.share),
      });
    }
    await tx.commissionCollectionAllocation.create({
      data: {
        tenantId,
        collectionId: collection.id,
        saleLineId: line.id,
        grossCents: delta.grossCents,
        netCents: delta.netCents,
        taxCents: delta.taxCents,
        evidence: {
          version: 1,
          postingStatus: "PENDING_RELEASE",
          kind,
          itemId: line.itemId,
          attributionStatus: sellers ? "KNOWN" : "UNKNOWN",
          sellers,
          rates,
          contracted: {
            netCents: original.purchase.netCents.toString(),
            taxCents: original.purchase.taxCents.toString(),
            grossCents: original.purchase.grossCents.toString(),
          },
          evaluatedAt: occurredAt.toISOString(),
        },
      },
    });
  }
  return tx.commissionCollection.findFirstOrThrow({
    where: { id: collection.id },
    include: { allocations: { orderBy: { saleLineId: "asc" } } },
  });
}
