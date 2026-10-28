import { z } from "zod";
import {
  allocatePayrollSplit,
  payrollBaseLineSchema,
  type CommissionShares,
  type PayrollCommissionType,
  payrollPackageSettingsSchema,
  payrollFixedSaleAward,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { conflict } from "../lib/http-error.js";
import { resolveCommission } from "./commission-rules.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export function payrollBusinessDate(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}
export async function appendPayrollSource(
  tx: Transaction,
  input: {
    sourceKey: string;
    sourceType: string;
    sourceId: string;
    saleId: string;
    occurredAt: Date;
    reason: string;
    commissionType: PayrollCommissionType;
    baseAmount: string | null;
    units: string;
    shares: CommissionShares | null;
    itemId: string;
    category?: string | null;
    mode?: "FOLLOW_PLAN" | "EXCLUDE" | "FIXED";
    fixedCommission?: string;
    missingEvidence?: string[];
    originalEventId?: string;
    sourceSnapshot?: import("../../generated/prisma/client.js").Prisma.InputJsonValue;
    confirmedSourceCurrency?: string | null;
    rateAt?: Date;
  },
) {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Payroll sources require tenant scope.");
  const prior = await tx.payrollSourceEvent.findFirst({ where: { sourceKey: input.sourceKey } });
  if (prior) return prior;
  const sale = await tx.sale.findFirstOrThrow({ where: { id: input.saleId } });
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: scope.tenantId },
    select: { timeZone: true },
  });
  const missing = [...(input.missingEvidence ?? [])];
  const currency = input.confirmedSourceCurrency ?? sale.collectionCurrency;
  if (!currency) missing.push("SALE_CURRENCY");
  if (!input.shares) missing.push("STAFF_ATTRIBUTION");
  if (input.baseAmount === null) missing.push("SOURCE_ECONOMICS");
  const bases =
    input.baseAmount !== null && input.shares
      ? allocatePayrollSplit(input.baseAmount, input.shares)
      : [];
  const units = input.shares ? allocatePayrollSplit(input.units, input.shares) : [];
  const fixed =
    input.fixedCommission !== undefined && input.shares
      ? allocatePayrollSplit(input.fixedCommission, input.shares)
      : [];
  const rateAt = input.rateAt ?? input.occurredAt;
  const rules = await tx.commissionRule.findMany({ where: { effectiveAt: { lte: rateAt } } });
  const lines = [];
  for (const base of bases) {
    const person = await tx.user.findFirst({ where: { id: base.staffId } });
    if (!person) throw conflict("Original payroll staff does not belong to this salon.");
    const kind =
      input.commissionType === "PKG_RED"
        ? "PACKAGE_REDEMPTION"
        : input.commissionType === "PKG_SALE"
          ? "PACKAGE_SALE"
          : input.commissionType === "VP_SALE"
            ? "STORED_CREDIT_SALE"
            : input.commissionType === "VP_SPEND"
              ? "STORED_CREDIT_SPEND"
              : input.commissionType === "PRD"
                ? "PRODUCT"
                : input.commissionType === "FOC"
                  ? "FOC"
                  : "SERVICE";
    const fallback = resolveCommission(
      rules,
      {
        staffId: base.staffId,
        itemKind: kind,
        itemId: input.itemId,
        departmentId: input.category ?? null,
        legacyServiceRate: person.commissionRate.toString(),
      },
      rateAt,
    );
    if (!fallback) missing.push("FALLBACK_RATE");
    lines.push(
      payrollBaseLineSchema.parse({
        id: `${input.sourceKey}:${base.staffId}`,
        staffId: base.staffId,
        outletId: sale.outletId,
        commissionType: input.commissionType,
        baseAmount: base.amount,
        units: units.find((row) => row.staffId === base.staffId)!.amount,
        businessDate: payrollBusinessDate(input.occurredAt, tenant.timeZone),
        status: "EARNED",
        productCategory: input.category ?? null,
        mode: input.mode ?? "FOLLOW_PLAN",
        ...(input.mode === "FIXED"
          ? { fixedCommission: fixed.find((row) => row.staffId === base.staffId)!.amount }
          : {}),
        ...(fallback ? { fallbackRatePct: fallback.rate } : {}),
      }),
    );
  }
  return tx.payrollSourceEvent.create({
    data: {
      tenantId: scope.tenantId,
      sourceKey: input.sourceKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      saleId: input.saleId,
      outletId: sale.outletId,
      actorId: scope.actorId ?? null,
      reason: input.reason,
      occurredAt: input.occurredAt,
      evidence: {
        version: 1,
        status: missing.length ? "UNAVAILABLE" : "CAPTURED",
        missingEvidence: [...new Set(missing)],
        currency,
        itemId: input.itemId,
        bases,
        units,
        lines,
        originalEventId: input.originalEventId ?? null,
        sourceSnapshot: input.sourceSnapshot ?? null,
        postingStatus: "PENDING_RELEASE",
      },
    },
  });
}

export async function capturePayrollCollection(tx: Transaction, collectionId: string) {
  const collection = await tx.commissionCollection.findFirstOrThrow({
    where: { id: collectionId },
    include: { allocations: true },
  });
  for (const allocation of collection.allocations) {
    const line = await tx.saleLine.findFirstOrThrow({ where: { id: allocation.saleLineId } });
    if (!["PACKAGE", "VALUE_PACKAGE"].includes(line.itemType)) continue;
    const evidence = z
      .object({ sellers: z.array(z.object({ staffId: z.string(), share: z.number() })).nullable() })
      .parse(allocation.evidence);
    // Holding is created after initial checkout collections. Read the locked catalogue only on that first payment.
    const holding =
      line.itemType === "PACKAGE"
        ? await tx.customerPackageHolding.findFirst({ where: { saleLineId: line.id } })
        : null;
    const settings =
      line.itemType === "PACKAGE"
        ? holding
          ? holding.payrollPurchaseSnapshot
            ? z
                .object({ commissionSettings: payrollPackageSettingsSchema.nullable().optional() })
                .parse(holding.payrollPurchaseSnapshot).commissionSettings
            : null
          : collection.sourceType === "SALE_PAYMENT"
            ? (await tx.package.findFirst({ where: { id: line.itemId } }))?.commissionSettings
            : null
        : null;
    const policy = settings ? payrollPackageSettingsSchema.parse(settings).sale : null;
    // Original fixed-per-sale award is captured once, on the first collection, never per instalment.
    const previous = await tx.commissionCollectionAllocation.findMany({
      where: { saleLineId: line.id, collectionId: { not: collectionId } },
    });
    const fixedAward =
      policy?.mode === "FIXED" ? payrollFixedSaleAward(policy.amount, previous.length) : undefined;
    await appendPayrollSource(tx, {
      sourceKey: `collection:${allocation.id}`,
      sourceType: "COLLECTION",
      sourceId: allocation.id,
      saleId: collection.saleId,
      occurredAt: collection.occurredAt,
      reason: collection.reason,
      commissionType: line.itemType === "PACKAGE" ? "PKG_SALE" : "VP_SALE",
      baseAmount: `${allocation.netCents / 100n}.${(allocation.netCents % 100n).toString().padStart(2, "0")}00`,
      units: previous.length === 0 ? `${line.quantity}.0000` : "0.0000",
      shares: evidence.sellers,
      itemId: line.itemId,
      mode: policy?.mode ?? "FOLLOW_PLAN",
      fixedCommission: fixedAward,
      missingEvidence:
        line.itemType === "PACKAGE" && !policy ? ["PACKAGE_COMMISSION_SETTINGS"] : [],
    });
  }
}

/** Reversals preserve original dates/rates in evidence; source time is the new event date. */
export async function reversePayrollSources(
  tx: Transaction,
  saleId: string,
  reason: string,
  sourceKey: string,
  onlySourceKey?: string,
) {
  const originals = await tx.payrollSourceEvent.findMany({
    where: {
      saleId,
      ...(onlySourceKey ? { sourceKey: onlySourceKey } : {}),
      sourceType: { notIn: ["REVERSAL", "PACKAGE_REFUND"] },
    },
  });
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Payroll reversal requires tenant scope.");
  for (const original of originals) {
    if (
      await tx.payrollSourceEvent.findFirst({
        where: { sourceType: "REVERSAL", sourceId: original.id },
      })
    )
      continue;
    const key = `${sourceKey}:${original.id}`;
    if (await tx.payrollSourceEvent.findFirst({ where: { sourceKey: key } })) continue;
    const evidence = z
      .object({ lines: z.array(payrollBaseLineSchema) })
      .passthrough()
      .parse(original.evidence);
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: scope.tenantId },
      select: { timeZone: true },
    });
    const at = new Date();
    const negate = (value: string) => (value.startsWith("-") ? value.slice(1) : `-${value}`);
    await tx.payrollSourceEvent.create({
      data: {
        tenantId: scope.tenantId,
        sourceKey: key,
        sourceType: "REVERSAL",
        sourceId: original.id,
        saleId,
        outletId: original.outletId,
        actorId: scope.actorId ?? null,
        reason,
        occurredAt: at,
        evidence: {
          ...evidence,
          originalEventId: original.id,
          lines: evidence.lines.map((line) => ({
            ...line,
            id: `${key}:${line.staffId}`,
            businessDate: payrollBusinessDate(at, tenant.timeZone),
            baseAmount: negate(line.baseAmount),
            units: negate(line.units),
            ...(line.fixedCommission !== undefined
              ? { fixedCommission: negate(line.fixedCommission) }
              : {}),
          })),
        } as import("../../generated/prisma/client.js").Prisma.InputJsonObject,
      },
    });
  }
}
