import {
  commissionAttributionSchema,
  payrollValueHoldingDetailSchema,
  payrollValuePackagePurchaseSchema,
  payrollValuePackageRefundAmounts,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/http-error.js";
import { packageMoneyToCents, packagePurchaseValue } from "../lib/package-valuation.js";
import { HttpError } from "../lib/http-error.js";
import { validateValuePackageCollectionSources } from "./payroll-value-collection-sources.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Consistent preview evidence only. The refund write independently revalidates all sources. */
export async function readPayrollValueHoldingDetail(
  tx: Transaction,
  customerId: string,
  holdingId: string,
) {
  const holding = await tx.customerValuePackageHolding.findFirst({
    where: { id: holdingId, customerId },
  });
  if (!holding) throw notFound("That customer value package does not exist.");
  const parsed = payrollValuePackagePurchaseSchema.safeParse(holding.payrollPurchaseSnapshot);
  const purchase = parsed.success ? parsed.data : null;
  const missingEvidence: string[] = [];
  const event = await tx.payrollSourceEvent.findFirst({
    where: { sourceType: "VALUE_PACKAGE_REFUND", sourceId: holdingId },
  });
  let originalTaxCents: string | null = null;
  let collectedNetCents: string | null = null;
  let collectedTaxCents: string | null = null;
  let usedBaseTicks: string | null = null;
  if (!purchase) missingEvidence.push("ORIGINAL_PURCHASE_EVIDENCE");
  else if (!purchase.currency || !purchase.sellers)
    missingEvidence.push("PURCHASE_CURRENCY_OR_SELLERS");
  else {
    const sale = await tx.sale.findFirst({
      where: { id: purchase.saleId },
      include: { refund: true },
    });
    const line = await tx.saleLine.findFirst({
      where: {
        id: purchase.saleLineId,
        saleId: purchase.saleId,
        itemType: "VALUE_PACKAGE",
        itemId: holding.valuePackageId,
      },
    });
    if (
      !sale ||
      sale.status !== "COMPLETED" ||
      sale.refund ||
      sale.collectionCurrency !== purchase.currency ||
      !line ||
      holding.saleLineId !== line.id
    )
      missingEvidence.push("ORIGINAL_SOURCE_LINEAGE");
    else {
      try {
        const original = packagePurchaseValue(
          line.lineTotal.toFixed(2),
          line.voucherDiscountAmount.toFixed(2),
          line.taxAmount.toFixed(2),
        );
        const attribution = commissionAttributionSchema.parse(line.attribution);
        const canonical = (shares: { staffId: string; share: number }[]) =>
          JSON.stringify([...shares].sort((a, b) => a.staffId.localeCompare(b.staffId)));
        if (
          original.netCents !== packageMoneyToCents(purchase.paidNet) ||
          holding.amount.toFixed(2) !== purchase.credit ||
          !attribution.sellers ||
          canonical(attribution.sellers) !== canonical(purchase.sellers)
        )
          throw new Error("Original economics/sellers changed.");
        const allocations = await tx.commissionCollectionAllocation.findMany({
          where: { saleLineId: line.id },
          include: { collection: true },
        });
        if (
          allocations.some(
            (row) =>
              row.netCents < 0n ||
              row.taxCents < 0n ||
              row.grossCents !== row.netCents + row.taxCents ||
              row.collection.saleId !== sale.id ||
              row.collection.currency !== purchase.currency,
          )
        )
          throw new Error("Collection components changed.");
        const net = allocations.reduce((sum, row) => sum + row.netCents, 0n);
        const tax = allocations.reduce((sum, row) => sum + row.taxCents, 0n);
        // Once cancelled, remaining credit is no longer a measure of historical usage.
        if (!event) {
          const redemptions = await tx.customerRedemption.findMany({
            where: { holdingId, itemType: "VALUE_PACKAGE", revertedAt: null },
          });
          if (
            redemptions.some((row) => !row.amount || row.amount.lessThan(0)) ||
            redemptions.reduce(
              (sum, row) => sum + packageMoneyToCents(row.amount!.toFixed(2)),
              0n,
            ) !==
              packageMoneyToCents(purchase.credit) -
                packageMoneyToCents(holding.amountRemaining.toFixed(2))
          )
            throw new Error("Credit use changed.");
        }
        const amounts = payrollValuePackageRefundAmounts({
          purchase,
          creditRemaining: event ? purchase.credit : holding.amountRemaining.toFixed(2),
          originalTaxCents: original.taxCents,
          collectedNet: net,
          collectedTax: tax,
          adminFeeNet: 0n,
        });
        originalTaxCents = original.taxCents.toString();
        collectedNetCents = net.toString();
        collectedTaxCents = tax.toString();
        usedBaseTicks = event ? null : amounts.usedTicks.toString();
        if (!event) {
          try {
            await validateValuePackageCollectionSources(tx, {
              saleId: sale.id,
              currency: purchase.currency,
              outletId: sale.outletId,
              sellers: purchase.sellers,
              allocations,
              requireRates: amounts.net > 0n,
            });
          } catch (error) {
            if (!(error instanceof HttpError)) throw error;
            missingEvidence.push("ORIGINAL_COLLECTION_SELLER_SOURCES");
          }
          if (amounts.cancelledGross > 0n) {
            const outstanding = await tx.customerOutstanding.findFirst({
              where: { saleId: sale.id },
            });
            if (
              !outstanding ||
              new Prisma.Decimal(amounts.cancelledGross.toString())
                .div(100)
                .greaterThan(outstanding.unpaidAmount)
            )
              missingEvidence.push("ORIGINAL_OUTSTANDING_BALANCE");
          }
        }
      } catch {
        missingEvidence.push("SOURCE_ECONOMICS_OR_USAGE");
      }
    }
  }
  // Parse recorded refund evidence rather than recalculating against cancelled credit.
  const refund = event
    ? payrollValueHoldingDetailSchema.shape.refund.parse({
        ...(event.evidence as Prisma.JsonObject),
        occurredAt: event.occurredAt.toISOString(),
        reason: event.reason,
      })
    : null;
  return payrollValueHoldingDetailSchema.parse({
    holdingId,
    updatedAt: holding.updatedAt.toISOString(),
    creditRemaining: holding.amountRemaining.toFixed(2),
    purchase,
    originalTaxCents,
    collectedNetCents,
    collectedTaxCents,
    usedBaseTicks,
    missingEvidence,
    refunded: !!event,
    refund,
  });
}

export async function getPayrollValueHoldingDetail(customerId: string, holdingId: string) {
  return prisma.$transaction((tx) => readPayrollValueHoldingDetail(tx, customerId, holdingId), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}
