import { z } from "zod";
import {
  customerHoldingHistorySchema,
  payrollValuePackagePurchaseSchema,
  readPayrollPackagePurchase,
  type CustomerHoldingHistory,
  type CustomerHoldingHistoryRow,
  type CustomerHoldingUsage,
} from "@glampro_suite/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/http-error.js";
import { packageMoneyToCents, packageRangeValue } from "../lib/package-valuation.js";
import { valuationClock } from "./package-valuation-ledger.js";

/**
 * Customer holding payment/session history (FR-RPT-06).
 *
 * The read answers three questions that used to need three screens: what this customer
 * bought, what they paid and used, and what is still unused, expired or owed. It is a
 * report, never a ledger: no money is recalculated, no expiry is written, and no source
 * row is repaired. A gap in evidence is named in `missingEvidence` instead.
 *
 * Remaining package value reuses `packageRangeValue` on the frozen purchase snapshot and
 * the remaining ordinals — the same arithmetic `/reports/package-valuation` totals
 * company-wide — so the customer view cannot drift from the company report. Credit,
 * receivables and unvalued holdings are reported beside it in separate buckets.
 */

const rangesSchema = z.array(z.strictObject({ first: z.number().int(), last: z.number().int() }));

type Value = { netCents: bigint; taxCents: bigint; grossCents: bigint };
const zero = (): Value => ({ netCents: 0n, taxCents: 0n, grossCents: 0n });
function add(target: Value, value: Value) {
  target.netCents += value.netCents;
  target.taxCents += value.taxCents;
  target.grossCents += value.grossCents;
}
function money(cents: bigint) {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export interface SessionHoldingSource {
  id: string;
  name: string;
  granted: number;
  remaining: number;
  expiresAt: Date | null;
  createdAt: Date;
  /** Stored `payrollPurchaseSnapshot`, or `null` for a legacy holding. */
  snapshot: unknown;
  /** Set when a snapshot is stored but unreadable, so the gap is named rather than hidden. */
  snapshotUnreadable?: boolean;
  /** Current remaining ordinals, when the holding carries a valuation state. */
  valuation: { availableOrdinals: unknown } | null;
  refunded: boolean;
}

export interface ValueHoldingSource {
  id: string;
  name: string;
  /** Decimal strings straight from the holding; never inferred from collected cash. */
  granted: string;
  remaining: string;
  expiresAt: Date | null;
  createdAt: Date;
  snapshot: unknown;
  snapshotUnreadable?: boolean;
  refunded: boolean;
}

export interface PaymentSource {
  saleLineId: string;
  id: string;
  occurredAt: Date;
  grossCents: bigint;
  netCents: bigint;
  taxCents: bigint;
}

export interface UsageSource {
  id: string;
  holdingId: string;
  itemType: "PACKAGE" | "VALUE_PACKAGE";
  saleId: string;
  quantity: number;
  amount: string | null;
  usedAt: Date;
  revertedAt: Date | null;
}

export interface OutstandingSource {
  saleId: string;
  /** Two-place decimal string, as stored on `CustomerOutstanding`. */
  unpaidAmount: string;
}

export interface CustomerHoldingHistorySource {
  asOf: Date;
  sessionHoldings: SessionHoldingSource[];
  valueHoldings: ValueHoldingSource[];
  payments: PaymentSource[];
  usage: UsageSource[];
  outstanding: OutstandingSource[];
}

type Status = CustomerHoldingHistoryRow["status"];

/** Refund first, then spent, then expired: the strongest fact names the row. */
function statusOf(input: {
  refunded: boolean;
  remaining: number | bigint;
  expiresAt: Date | null;
  asOf: Date;
}): Status {
  if (input.refunded) return "REFUNDED";
  const spent =
    typeof input.remaining === "bigint" ? input.remaining === 0n : input.remaining === 0;
  if (spent) return "EXHAUSTED";
  if (input.expiresAt && input.expiresAt <= input.asOf) return "EXPIRED";
  return "ACTIVE";
}

function readSessionPurchase(snapshot: unknown) {
  try {
    return readPayrollPackagePurchase(snapshot);
  } catch {
    return null;
  }
}

function missingFor(purchase: unknown, unreadable: boolean | undefined) {
  if (purchase) return [];
  return unreadable
    ? ["ORIGINAL_PURCHASE_EVIDENCE_UNREADABLE", "ORIGINAL_PURCHASE_EVIDENCE"]
    : ["ORIGINAL_PURCHASE_EVIDENCE"];
}

/**
 * Pure assembly from already-loaded evidence, so every bucket rule is testable without a
 * database. Holdings are newest first; payments and usage are oldest first.
 */
export function buildCustomerHoldingHistory(
  customerId: string,
  source: CustomerHoldingHistorySource,
): CustomerHoldingHistory {
  const byTime =
    <T extends { id: string }>(time: (row: T) => Date) =>
    (a: T, b: T) =>
      time(a).getTime() - time(b).getTime() || a.id.localeCompare(b.id);
  const paymentsByLine = new Map<string, PaymentSource[]>();
  for (const payment of [...source.payments].sort(byTime((row) => row.occurredAt))) {
    const list = paymentsByLine.get(payment.saleLineId);
    if (list) list.push(payment);
    else paymentsByLine.set(payment.saleLineId, [payment]);
  }
  const usageByHolding = new Map<string, CustomerHoldingUsage[]>();
  for (const draw of [...source.usage].sort(byTime((row) => row.usedAt))) {
    const entry: CustomerHoldingUsage = {
      id: draw.id,
      itemType: draw.itemType,
      saleId: draw.saleId,
      quantity: draw.quantity,
      // Sub-cent credit is corruption, not something to round into a report.
      amount: draw.amount === null ? null : money(packageMoneyToCents(draw.amount)),
      usedAt: draw.usedAt.toISOString(),
      revertedAt: draw.revertedAt?.toISOString() ?? null,
    };
    const list = usageByHolding.get(draw.holdingId);
    if (list) list.push(entry);
    else usageByHolding.set(draw.holdingId, [entry]);
  }
  const paymentsOf = (saleLineId: string | null) =>
    (saleLineId ? (paymentsByLine.get(saleLineId) ?? []) : []).map((payment) => ({
      id: payment.id,
      occurredAt: payment.occurredAt.toISOString(),
      grossCents: payment.grossCents.toString(),
      netCents: payment.netCents.toString(),
      taxCents: payment.taxCents.toString(),
    }));

  const activeValue = zero();
  const expiredValue = zero();
  const activeValued = { holdings: 0, sessionsRemaining: 0 };
  const expiredValued = { holdings: 0, sessionsRemaining: 0 };
  const activeUnvalued = { holdings: 0, sessionsRemaining: 0 };
  const expiredUnvalued = { holdings: 0, sessionsRemaining: 0 };
  const creditActive = { holdings: 0, remainingCents: 0n };
  const creditExpired = { holdings: 0, remainingCents: 0n };
  const rows: CustomerHoldingHistoryRow[] = [];
  /** Source sales of the purchases reported here; receivables are read from these only. */
  const sourceSaleIds = new Set<string>();

  for (const holding of source.sessionHoldings) {
    const purchase = holding.snapshot ? readSessionPurchase(holding.snapshot) : null;
    const missingEvidence = missingFor(purchase, holding.snapshotUnreadable);
    if (purchase && (!purchase.currency || !purchase.sellers))
      missingEvidence.push("PURCHASE_CURRENCY_OR_SELLERS");
    const status = statusOf({
      refunded: holding.refunded,
      remaining: holding.remaining,
      expiresAt: holding.expiresAt,
      asOf: source.asOf,
    });
    let value: Value | null = null;
    if (purchase && holding.valuation && !holding.refunded) {
      try {
        const allocated = packageRangeValue(
          {
            netCents: BigInt(purchase.netCents),
            taxCents: BigInt(purchase.taxCents),
            grossCents: BigInt(purchase.grossCents),
          },
          purchase.grantedSessions,
          rangesSchema.parse(holding.valuation.availableOrdinals),
        );
        // The valuation ledger keeps remaining ordinals equal to the holding count; a
        // disagreement is corruption, so the row is downgraded to unvalued and named.
        if (allocated.quantity !== holding.remaining) missingEvidence.push("VALUATION_MISMATCH");
        else
          value = {
            netCents: allocated.netCents,
            taxCents: allocated.taxCents,
            grossCents: allocated.grossCents,
          };
      } catch {
        missingEvidence.push("REMAINING_ORDINALS_UNREADABLE");
      }
    }
    if (purchase) sourceSaleIds.add(purchase.saleId);
    if (status === "ACTIVE" || status === "EXPIRED") {
      const bucket = status === "ACTIVE" ? activeValued : expiredValued;
      if (value) {
        add(status === "ACTIVE" ? activeValue : expiredValue, value);
        bucket.holdings++;
        bucket.sessionsRemaining += holding.remaining;
      } else if (holding.remaining > 0) {
        const unvalued = status === "ACTIVE" ? activeUnvalued : expiredUnvalued;
        unvalued.holdings++;
        unvalued.sessionsRemaining += holding.remaining;
      }
    }
    rows.push({
      holdingId: holding.id,
      kind: "SESSIONS",
      name: holding.name,
      status,
      purchasedAt: purchase?.purchasedAt ?? holding.createdAt.toISOString(),
      saleId: purchase?.saleId ?? null,
      expiresAt: holding.expiresAt?.toISOString() ?? null,
      sessions: { granted: holding.granted, remaining: holding.remaining },
      credit: null,
      value: value
        ? {
            net: money(value.netCents),
            originalTax: money(value.taxCents),
            gross: money(value.grossCents),
          }
        : null,
      payments: paymentsOf(purchase?.saleLineId ?? null),
      usage: usageByHolding.get(holding.id) ?? [],
      missingEvidence,
    });
  }

  for (const holding of source.valueHoldings) {
    const parsed = payrollValuePackagePurchaseSchema.safeParse(holding.snapshot);
    const purchase = parsed.success ? parsed.data : null;
    const missingEvidence = missingFor(purchase, holding.snapshotUnreadable);
    if (purchase && (!purchase.currency || !purchase.sellers))
      missingEvidence.push("PURCHASE_CURRENCY_OR_SELLERS");
    const grantedCents = packageMoneyToCents(holding.granted);
    const remainingCents = packageMoneyToCents(holding.remaining);
    if (purchase && packageMoneyToCents(purchase.credit) !== grantedCents)
      missingEvidence.push("CREDIT_GRANT_MISMATCH");
    if (remainingCents > grantedCents) missingEvidence.push("CREDIT_BALANCE_EXCEEDS_GRANT");
    const status = statusOf({
      refunded: holding.refunded,
      remaining: remainingCents,
      expiresAt: holding.expiresAt,
      asOf: source.asOf,
    });
    if (purchase) sourceSaleIds.add(purchase.saleId);
    if (status === "ACTIVE" || status === "EXPIRED") {
      const bucket = status === "ACTIVE" ? creditActive : creditExpired;
      bucket.holdings++;
      bucket.remainingCents += remainingCents;
    }
    rows.push({
      holdingId: holding.id,
      kind: "VALUE",
      name: holding.name,
      status,
      // The value-package snapshot carries no purchase date; the holding's own creation
      // instant is the purchase, and it is never taken from today's catalogue.
      purchasedAt: holding.createdAt.toISOString(),
      saleId: purchase?.saleId ?? null,
      expiresAt: holding.expiresAt?.toISOString() ?? null,
      sessions: null,
      credit: { granted: money(grantedCents), remaining: money(remainingCents) },
      value: null,
      payments: paymentsOf(purchase?.saleLineId ?? null),
      usage: usageByHolding.get(holding.id) ?? [],
      missingEvidence,
    });
  }

  rows.sort(
    (a, b) =>
      (b.purchasedAt ?? "").localeCompare(a.purchasedAt ?? "") ||
      a.holdingId.localeCompare(b.holdingId),
  );
  const unpaid = new Set<string>();
  let outstandingCents = 0n;
  for (const row of source.outstanding) {
    if (!sourceSaleIds.has(row.saleId)) continue;
    const cents = packageMoneyToCents(row.unpaidAmount);
    if (cents <= 0n) continue;
    unpaid.add(row.saleId);
    outstandingCents += cents;
  }

  return customerHoldingHistorySchema.parse({
    customerId,
    asOf: source.asOf.toISOString(),
    active: {
      holdings: activeValued.holdings,
      sessionsRemaining: activeValued.sessionsRemaining,
      net: money(activeValue.netCents),
      originalTax: money(activeValue.taxCents),
      gross: money(activeValue.grossCents),
    },
    expired: {
      holdings: expiredValued.holdings,
      sessionsRemaining: expiredValued.sessionsRemaining,
      net: money(expiredValue.netCents),
      originalTax: money(expiredValue.taxCents),
      gross: money(expiredValue.grossCents),
    },
    credit: {
      active: { holdings: creditActive.holdings, remaining: money(creditActive.remainingCents) },
      expired: { holdings: creditExpired.holdings, remaining: money(creditExpired.remainingCents) },
    },
    unvalued: { active: activeUnvalued, expired: expiredUnvalued },
    receivable: {
      sales: unpaid.size,
      holdings: rows.filter((row) => row.saleId !== null && unpaid.has(row.saleId)).length,
      sourceSaleOutstanding: money(outstandingCents),
    },
    holdings: rows,
  });
}

function unreadable(snapshot: unknown, read: (value: unknown) => unknown) {
  return snapshot !== null && snapshot !== undefined && read(snapshot) === null;
}

/**
 * One repeatable-read snapshot, so payments, usage and balances cannot disagree. Nothing
 * is locked and nothing is written: expiry is judged against the server clock, so a pending
 * expiry reads as expired without this read changing a row.
 */
export async function customerHoldingHistory(customerId: string) {
  return prisma.$transaction(
    async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId },
        select: { id: true },
      });
      // Another salon's customer is simply not found, the rule every customer route keeps.
      if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
      const asOf = await valuationClock(tx);
      const sessionHoldings = await tx.customerPackageHolding.findMany({
        where: { customerId },
        include: { package: { select: { name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const valueHoldings = await tx.customerValuePackageHolding.findMany({
        where: { customerId },
        include: { valuePackage: { select: { name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const sessionIds = sessionHoldings.map((row) => row.id);
      const valueIds = valueHoldings.map((row) => row.id);
      const snapshots = await tx.packagePurchaseSnapshot.findMany({
        where: { holdingId: { in: sessionIds } },
        include: { state: { select: { availableOrdinals: true } } },
      });
      const snapshotByHolding = new Map(snapshots.map((row) => [row.holdingId, row]));
      const valuePurchases = valueHoldings.map((holding) => {
        const parsed = payrollValuePackagePurchaseSchema.safeParse(holding.payrollPurchaseSnapshot);
        return { holding, purchase: parsed.success ? parsed.data : null };
      });
      const saleLineIds = [
        ...new Set([
          ...snapshots.map((row) => row.saleLineId),
          ...valuePurchases.flatMap((row) => (row.purchase ? [row.purchase.saleLineId] : [])),
        ]),
      ];
      const saleIds = [
        ...new Set([
          ...snapshots.map((row) => row.saleId),
          ...valuePurchases.flatMap((row) => (row.purchase ? [row.purchase.saleId] : [])),
        ]),
      ];
      const allocations = await tx.commissionCollectionAllocation.findMany({
        where: { saleLineId: { in: saleLineIds } },
        include: { collection: { select: { id: true, occurredAt: true } } },
      });
      const refunds = await tx.payrollSourceEvent.findMany({
        where: {
          sourceId: { in: [...sessionIds, ...valueIds] },
          sourceType: { in: ["PACKAGE_REFUND", "VALUE_PACKAGE_REFUND"] },
        },
        select: { sourceType: true, sourceId: true },
      });
      const refundedPackages = new Set(
        refunds.filter((row) => row.sourceType === "PACKAGE_REFUND").map((row) => row.sourceId),
      );
      const refundedValues = new Set(
        refunds
          .filter((row) => row.sourceType === "VALUE_PACKAGE_REFUND")
          .map((row) => row.sourceId),
      );
      const redemptions = await tx.customerRedemption.findMany({
        where: {
          holdingId: { in: [...sessionIds, ...valueIds] },
          itemType: { in: ["PACKAGE", "VALUE_PACKAGE"] },
        },
        orderBy: [{ usedAt: "asc" }, { id: "asc" }],
      });
      const outstanding = await tx.customerOutstanding.findMany({
        where: { saleId: { in: saleIds }, unpaidAmount: { gt: 0 } },
        select: { saleId: true, unpaidAmount: true },
      });

      return buildCustomerHoldingHistory(customerId, {
        asOf,
        sessionHoldings: sessionHoldings.map((holding) => {
          const snapshot = snapshotByHolding.get(holding.id);
          return {
            id: holding.id,
            name: holding.package.name,
            granted: holding.quantity,
            remaining: holding.quantityRemaining,
            expiresAt: holding.expiresAt,
            createdAt: holding.createdAt,
            snapshot: holding.payrollPurchaseSnapshot,
            snapshotUnreadable: unreadable(holding.payrollPurchaseSnapshot, readSessionPurchase),
            valuation: snapshot?.state
              ? { availableOrdinals: snapshot.state.availableOrdinals }
              : null,
            refunded: refundedPackages.has(holding.id),
          };
        }),
        valueHoldings: valuePurchases.map(({ holding }) => ({
          id: holding.id,
          name: holding.valuePackage.name,
          granted: holding.amount.toFixed(2),
          remaining: holding.amountRemaining.toFixed(2),
          expiresAt: holding.expiresAt,
          createdAt: holding.createdAt,
          snapshot: holding.payrollPurchaseSnapshot,
          snapshotUnreadable: unreadable(
            holding.payrollPurchaseSnapshot,
            (value) => payrollValuePackagePurchaseSchema.safeParse(value).success || null,
          ),
          refunded: refundedValues.has(holding.id),
        })),
        payments: allocations.map((row) => ({
          saleLineId: row.saleLineId,
          id: row.collection.id,
          occurredAt: row.collection.occurredAt,
          grossCents: row.grossCents,
          netCents: row.netCents,
          taxCents: row.taxCents,
        })),
        usage: redemptions.flatMap((row) =>
          row.holdingId && (row.itemType === "PACKAGE" || row.itemType === "VALUE_PACKAGE")
            ? [
                {
                  id: row.id,
                  holdingId: row.holdingId,
                  itemType: row.itemType,
                  saleId: row.saleId,
                  quantity: row.quantity,
                  amount: row.amount?.toFixed(2) ?? null,
                  usedAt: row.usedAt,
                  revertedAt: row.revertedAt,
                },
              ]
            : [],
        ),
        outstanding: outstanding.flatMap((row) =>
          row.saleId ? [{ saleId: row.saleId, unpaidAmount: row.unpaidAmount.toFixed(2) }] : [],
        ),
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 },
  );
}
