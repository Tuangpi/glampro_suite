import {
  recordSaleCollectionSchema,
  saleCollectionStateSchema,
  type RecordSaleCollectionInput,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { currentScope, currentOutletId } from "../lib/tenant-context.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/http-error.js";
import { lockPrepaid } from "../lib/prepaid-lock.js";
import { packageMoneyToCents } from "../lib/package-valuation.js";
import { captureCollectionEvidence } from "./commission-collection-evidence.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function collectionState(tx: Transaction, saleId: string) {
  const sale = await tx.sale.findFirst({
    where: { id: saleId, ...(currentOutletId() ? { outletId: currentOutletId() } : {}) },
    include: { refund: true, lines: { orderBy: { position: "asc" } } },
  });
  if (!sale) throw notFound("That sale does not exist.", "SALE_NOT_FOUND");
  const outstanding = await tx.customerOutstanding.findFirst({ where: { saleId } });
  const collections = await tx.commissionCollection.findMany({
    where: { saleId },
    include: { allocations: { orderBy: { saleLineId: "asc" } } },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  return saleCollectionStateSchema.parse({
    saleId,
    currency: sale.collectionCurrency,
    outstandingCents: outstanding
      ? packageMoneyToCents(outstanding.unpaidAmount.toFixed(2)).toString()
      : "0",
    canCollect:
      sale.status === "COMPLETED" &&
      !sale.refund &&
      sale.collectionCurrency === "SGD" &&
      sale.customerId !== null &&
      outstanding?.customerId === sale.customerId &&
      outstanding.unpaidAmount.greaterThan(0),
    lines: sale.lines.map((line) => ({
      saleLineId: line.id,
      itemName: line.itemName,
      contractedGrossCents: packageMoneyToCents(
        line.lineTotal.minus(line.voucherDiscountAmount).toFixed(2),
      ).toString(),
      allocatedGrossCents: collections
        .flatMap((row) => row.allocations)
        .filter((row) => row.saleLineId === line.id)
        .reduce((sum, row) => sum + row.grossCents, 0n)
        .toString(),
    })),
    payments: collections
      .filter((row) => row.sourceType === "OUTSTANDING_PAYMENT")
      .map((row) => ({
        collectionId: row.id,
        paymentId: row.sourceId,
        grossCents: row.grossCents.toString(),
        occurredAt: row.occurredAt.toISOString(),
        reason: row.reason,
        allocations: row.allocations.map((allocation) => ({
          saleLineId: allocation.saleLineId,
          grossCents: allocation.grossCents.toString(),
        })),
      })),
  });
}

/** Consistent read; historical/unconfirmed currency is never upgraded here. */
export async function getSaleCollectionState(saleId: string) {
  return prisma.$transaction((tx) => collectionState(tx, saleId), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

export async function recordSaleCollection(saleId: string, value: RecordSaleCollectionInput) {
  const input = recordSaleCollectionSchema.parse(value);
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId)
    throw forbidden("An authenticated salon actor is required.");
  const { tenantId } = scope;
  return prisma.$transaction(async (tx) => {
    // Same ordering as POS/void/refund: tenant prepaid lock, sale, configuration.
    await lockPrepaid(tx, tenantId);
    const sale = await tx.sale.findFirst({
      where: { id: saleId, ...(currentOutletId() ? { outletId: currentOutletId() } : {}) },
      include: { refund: true },
    });
    if (!sale) throw notFound("That sale does not exist.", "SALE_NOT_FOUND");
    await tx.sale.update({ where: { id: saleId }, data: { updatedAt: new Date() } });
    const eventKey = `later:${input.idempotencyKey}`;
    const existing = await tx.commissionCollection.findFirst({ where: { eventKey } });
    const evidence = {
      eventKey,
      sourceType: "OUTSTANDING_PAYMENT" as const,
      saleId,
      currency: input.currency,
      reason: input.reason,
      allocations: input.allocations,
    };
    if (existing) {
      if (existing.grossCents !== BigInt(input.grossCents))
        throw conflict(
          "This retry key has a different collected amount.",
          "COLLECTION_RETRY_MISMATCH",
        );
      // Reuses canonical hash comparison (including actor, sale, reason and allocations).
      await captureCollectionEvidence(tx, { ...evidence, sourceId: existing.sourceId });
      return collectionState(tx, saleId);
    }
    if (sale.status !== "COMPLETED" || sale.refund || !sale.customerId)
      throw conflict("Only completed, unrefunded customer sales can receive collections.");
    if (sale.collectionCurrency !== input.currency)
      throw conflict(
        "This sale has no matching confirmed currency; historical evidence cannot be inferred.",
        "COLLECTION_CURRENCY_UNKNOWN",
      );
    const outstanding = await tx.customerOutstanding.findFirst({
      where: { saleId, customerId: sale.customerId },
    });
    const amount = new Prisma.Decimal(input.grossCents).dividedBy(100);
    if (!outstanding || amount.greaterThan(outstanding.unpaidAmount))
      throw conflict(
        "The collected amount exceeds the current outstanding balance.",
        "COLLECTION_EXCEEDS_BALANCE",
      );
    const source = await tx.customerOutstandingPayment.create({
      data: {
        tenantId,
        customerId: sale.customerId,
        saleId,
        outstandingId: outstanding.id,
        paidAmount: amount,
        paidAt: new Date(),
        note: input.reason,
      },
    });
    try {
      await captureCollectionEvidence(tx, { ...evidence, sourceId: source.id });
    } catch (error) {
      if (error instanceof RangeError)
        throw badRequest(error.message, undefined, "COLLECTION_ALLOCATION_INVALID");
      throw error;
    }
    await tx.customerOutstanding.update({
      where: { id: outstanding.id },
      data: { unpaidAmount: { decrement: amount } },
    });
    // Original checkout paidAmount/tenders and points are historical snapshots.
    return collectionState(tx, saleId);
  });
}
