import { createHash } from "node:crypto";
import { z } from "zod";
import {
  allocatePayrollSplit,
  payrollBaseLineSchema,
  payrollFixedSaleClawback,
  payrollPackageRefundAmounts,
  payrollValuePackageRefundAmounts,
  readPayrollPackagePurchase,
  refundPayrollPackageSchema,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { conflict } from "../lib/http-error.js";
import { payrollInputHash } from "./payroll-close-state.js";
import { payrollBusinessDate } from "./payroll-source-event.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const fail = (): never => {
  throw conflict(
    "Authoritative payroll inputs unavailable: PREPAID_REFUND_SETTLEMENT_UNCONFIRMED.",
  );
};
const json = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
const hash = (value: unknown) => payrollInputHash(json(value));
const record = z.record(z.string(), z.unknown());
const cents = z.string().regex(/^(0|[1-9]\d*)$/);
const evidenceSchema = z.object({
  version: z.literal(1),
  request: refundPayrollPackageSchema,
  operationalHash: z.string(),
  operational: z
    .object({
      holding: record,
      sale: record,
      line: record,
      allocations: z.array(record).min(1),
      sources: z.array(record).min(1),
      outstanding: record.nullable(),
      amounts: z.record(z.string(), cents),
    })
    .passthrough(),
});
type Event = Awaited<ReturnType<PayrollCloseTransaction["payrollSourceEvent"]["findMany"]>>[number];
type Holding =
  | Awaited<ReturnType<PayrollCloseTransaction["customerPackageHolding"]["findMany"]>>[number]
  | Awaited<ReturnType<PayrollCloseTransaction["customerValuePackageHolding"]["findMany"]>>[number];
const without = (value: unknown, keys: string[]) => {
  const row = record.parse(json(value));
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
};

/** Validate independent settlement before replaying a cancelled holding. This is
 * deliberately NOT sufficient for monthly admission: the caller must replay the
 * complete holding history against preHolding and reconcile all monthly inventory.
 * No evidence is synthesized for legacy refund captures. */
export async function loadPayrollPrepaidSettlement(
  tx: PayrollCloseTransaction,
  input: { tenantId: string; holding: Holding; event: Event; timeZone: string },
) {
  try {
    const { tenantId, holding, event, timeZone } = input;
    const credit = event.sourceType === "VALUE_PACKAGE_REFUND";
    if (!credit && event.sourceType !== "PACKAGE_REFUND") return fail();
    const [rows, captures, sale, line, allocations, outstanding] = await Promise.all([
      tx.prepaidRefundSettlement.findMany({ where: { tenantId, holdingId: holding.id } }),
      tx.payrollSourceEvent.findMany({
        where: { tenantId, sourceId: holding.id, sourceType: event.sourceType },
      }),
      tx.sale.findFirst({ where: { tenantId, id: event.saleId } }),
      tx.saleLine.findFirst({ where: { tenantId, id: holding.saleLineId! } }),
      tx.commissionCollectionAllocation.findMany({
        where: { tenantId, saleLineId: holding.saleLineId! },
        include: { collection: true },
      }),
      tx.customerOutstanding.findFirst({ where: { tenantId, saleId: event.saleId } }),
    ]);
    if (rows.length !== 1 || captures.length !== 1 || hash(captures[0]) !== hash(event))
      return fail();
    const settlement = rows[0];
    const evidence = evidenceSchema.parse(settlement.evidence);
    const { request, operational: op } = evidence;
    const pre = op.holding;
    const prefix = credit ? "value-package-refund" : "package-refund";
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ ...request, holdingId: holding.id, actorId: settlement.actorId }))
      .digest("hex");
    if (
      !request.settlement ||
      !sale ||
      !line ||
      !sale.outletId ||
      settlement.tenantId !== tenantId ||
      holding.tenantId !== tenantId ||
      settlement.itemType !== (credit ? "VALUE_PACKAGE" : "PACKAGE") ||
      settlement.sourceKey !== `${prefix}:${request.idempotencyKey}` ||
      settlement.sourceKey !== event.sourceKey ||
      settlement.holdingId !== event.sourceId ||
      settlement.saleId !== sale.id ||
      settlement.saleId !== event.saleId ||
      settlement.saleLineId !== line.id ||
      line.saleId !== sale.id ||
      line.itemType !== settlement.itemType ||
      sale.status !== "COMPLETED" ||
      sale.collectionCurrency !== "SGD" ||
      settlement.currency !== "SGD" ||
      event.tenantId !== tenantId ||
      event.outletId !== sale.outletId ||
      event.actorId !== settlement.actorId ||
      event.reason !== settlement.reason ||
      request.reason !== settlement.reason ||
      !["MANAGER", "SUPER_ADMIN"].includes(settlement.actorRole) ||
      request.settlement.reference !== settlement.reference ||
      settlement.requestHash !== requestHash ||
      event.occurredAt.getTime() !== settlement.occurredAt.getTime() ||
      event.createdAt < event.occurredAt ||
      settlement.createdAt < settlement.occurredAt ||
      sale.soldAt > event.occurredAt ||
      pre.updatedAt !== request.expectedUpdatedAt ||
      new Date(request.expectedUpdatedAt) > event.occurredAt ||
      hash(op) !== evidence.operationalHash ||
      hash(without(op.sale, ["refund"])) !== hash(sale) ||
      hash(op.line) !== hash(line) ||
      hash(
        without(
          holding,
          credit
            ? ["amountRemaining", "updatedAt", "updatedBy"]
            : ["quantityRemaining", "payrollAvailableOrdinals", "updatedAt"],
        ),
      ) !==
        hash(
          without(
            pre,
            credit
              ? ["amountRemaining", "updatedAt", "updatedBy"]
              : ["quantityRemaining", "payrollAvailableOrdinals", "updatedAt"],
          ),
        )
    )
      return fail();
    const sources = await tx.payrollSourceEvent.findMany({
      where: {
        tenantId,
        sourceType: "COLLECTION",
        sourceId: { in: allocations.map((row) => row.id) },
      },
    });
    const inventory = (values: unknown[]) => values.map(hash).sort();
    if (
      hash(inventory(op.allocations.map((row) => without(row, ["collection"])))) !==
        hash(inventory(allocations.map((row) => without(row, ["collection"])))) ||
      hash(inventory(op.sources)) !== hash(inventory(sources)) ||
      allocations.some(
        (row) =>
          row.tenantId !== tenantId ||
          row.collection.tenantId !== tenantId ||
          row.collection.saleId !== sale.id ||
          row.collection.currency !== "SGD" ||
          row.collection.occurredAt > event.occurredAt,
      ) ||
      sources.length !== allocations.length ||
      sources.some(
        (row) =>
          row.saleId !== sale.id ||
          row.outletId !== sale.outletId ||
          row.occurredAt > event.occurredAt,
      )
    )
      return fail();
    const net = allocations.reduce((sum, row) => sum + row.netCents, 0n);
    const tax = allocations.reduce((sum, row) => sum + row.taxCents, 0n);
    const purchase = pre.payrollPurchaseSnapshot;
    const available = z
      .array(z.object({ first: z.number().int().positive(), last: z.number().int().positive() }))
      .parse(credit ? [] : pre.payrollAvailableOrdinals);
    const amounts = credit
      ? payrollValuePackageRefundAmounts({
          purchase,
          creditRemaining: new Prisma.Decimal(z.string().parse(pre.amountRemaining)).toFixed(2),
          originalTaxCents: BigInt(line.taxAmount.mul(100).toFixed(0)),
          collectedNet: net,
          collectedTax: tax,
          adminFeeNet: BigInt(request.adminFeeNetCents),
        })
      : payrollPackageRefundAmounts({
          purchase: readPayrollPackagePurchase(purchase),
          available,
          quantityRemaining: z.number().int().nonnegative().parse(pre.quantityRemaining),
          collectedNet: net,
          collectedTax: tax,
          adminFeeNet: BigInt(request.adminFeeNetCents),
        });
    if (
      hash(amounts) !== hash(op.amounts) ||
      settlement.netCents !== amounts.net ||
      settlement.taxCents !== amounts.tax ||
      settlement.grossCents !== amounts.gross ||
      settlement.cancelledGrossCents !== amounts.cancelledGross ||
      request.payoutGrossCents !== amounts.gross.toString() ||
      settlement.payoutMethod !== request.payoutMethod ||
      (amounts.gross === 0n) !== (request.payoutMethod === "NONE")
    )
      return fail();
    if (op.outstanding) {
      if (
        !outstanding ||
        hash(without(outstanding, ["unpaidAmount", "updatedAt"])) !==
          hash(without(op.outstanding, ["unpaidAmount", "updatedAt"])) ||
        BigInt(
          new Prisma.Decimal(z.string().parse(op.outstanding.unpaidAmount)).mul(100).toFixed(0),
        ) -
          amounts.cancelledGross !==
          BigInt(outstanding.unpaidAmount.mul(100).toFixed(0))
      )
        return fail();
    } else if (outstanding || amounts.cancelledGross !== 0n) return fail();
    const originalLines = sources.flatMap(
      (row) => z.object({ lines: z.array(payrollBaseLineSchema) }).parse(row.evidence).lines,
    );
    const sellers = z
      .object({ sellers: z.array(z.object({ staffId: z.string(), share: z.number() })) })
      .parse(purchase).sellers;
    const policy = credit ? null : readPayrollPackagePurchase(purchase).commissionSettings!.sale;
    const decimal = (value: bigint) =>
      `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}00`;
    const bases = amounts.net > 0n ? allocatePayrollSplit(`-${decimal(amounts.net)}`, sellers) : [];
    const fixed =
      policy?.mode === "FIXED" && amounts.net > 0n
        ? allocatePayrollSplit(
            payrollFixedSaleClawback(
              (() => {
                const ticks = originalLines.reduce(
                  (sum, row) =>
                    sum +
                    BigInt(
                      z
                        .string()
                        .regex(/^\d+\.\d{4}$/)
                        .parse(row.fixedCommission)
                        .replace(".", ""),
                    ),
                  0n,
                );
                return `${ticks / 10000n}.${(ticks % 10000n).toString().padStart(4, "0")}`;
              })(),
              amounts.net,
              BigInt(readPayrollPackagePurchase(purchase).netCents),
            ),
            sellers,
          )
        : [];
    const expectedLines = bases.map((base) =>
      payrollBaseLineSchema.parse({
        ...originalLines.find((row) => row.staffId === base.staffId),
        id: `${event.sourceKey}:${base.staffId}`,
        baseAmount: base.amount,
        units: "0.0000",
        status: "EARNED",
        businessDate: payrollBusinessDate(event.occurredAt, timeZone),
        ...(policy?.mode === "FIXED"
          ? { fixedCommission: fixed.find((row) => row.staffId === base.staffId)!.amount }
          : {}),
      }),
    );
    const capture = z
      .object({
        version: z.literal(1),
        status: z.literal("CAPTURED"),
        postingStatus: z.literal("PENDING_RELEASE"),
        requestHash: z.string(),
        currency: z.literal("SGD"),
        netCents: cents,
        taxCents: cents,
        grossCents: cents,
        usedBaseTicks: cents,
        adminFeeNetCents: cents,
        payoutMethod: z.string(),
        originalSourceIds: z.array(z.string()),
        purchase: z.unknown(),
        lines: z.array(payrollBaseLineSchema),
      })
      .parse(event.evidence);
    if (
      capture.requestHash !== requestHash ||
      capture.netCents !== amounts.net.toString() ||
      capture.taxCents !== amounts.tax.toString() ||
      capture.grossCents !== amounts.gross.toString() ||
      capture.usedBaseTicks !== amounts.usedTicks.toString() ||
      capture.adminFeeNetCents !== request.adminFeeNetCents ||
      capture.payoutMethod !== request.payoutMethod ||
      hash(capture.purchase) !== hash(purchase) ||
      hash(capture.lines) !== hash(expectedLines) ||
      hash([...capture.originalSourceIds].sort()) !== hash(sources.map((row) => row.id).sort())
    )
      return fail();
    const extra = record.parse(event.evidence);
    if (
      credit
        ? extra.cancelledCreditCents !==
            (
              amounts as ReturnType<typeof payrollValuePackageRefundAmounts>
            ).cancelledCreditCents.toString() ||
          extra.cancelledGrossCents !== amounts.cancelledGross.toString()
        : hash(extra.remainingOrdinals) !== hash(available)
    )
      return fail();
    return { settlement, event, preHolding: pre, sources, allocations, amounts };
  } catch {
    return fail();
  }
}
