import { conflict } from "../lib/http-error.js";
import { resolvePayrollCloseSources } from "./payroll-close-sources.js";
import { verifyPayrollValueSpend } from "./payroll-close-value-spend.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

type Spend = Parameters<typeof verifyPayrollValueSpend>[0];
type Balance = Awaited<
  ReturnType<PayrollCloseTransaction["prepaidBalanceEvent"]["findMany"]>
>[number];
type Event = Awaited<ReturnType<PayrollCloseTransaction["payrollSourceEvent"]["findMany"]>>[number];
const fail = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: VALUE_RESTORATION_UNCONFIRMED.");
};

/** Supplied-record seam, not monthly readiness. The caller must load complete
 * inventories and independently replay ownership and balance order. A refund is
 * not a restoration; only the operational void writer produces this evidence. */
export function verifyPayrollValueRestoration(input: {
  spend: Omit<Spend, "sale"> & {
    sale: Spend["sale"] & {
      voidedAt: Date | null;
      voidedById: string | null;
      voidReason: string | null;
    };
  };
  balances: Balance[];
  reversals: Event[];
  refundIds: string[];
  /** Independently replayed restore-time expiry; omitted for unchanged-expiry callers. */
  restorationExpiresAt?: Date | null;
}) {
  const { spend } = input;
  const { sale } = spend;
  const { redemption, event, holding } = spend;
  const revertedAt = redemption.revertedAt;
  if (
    sale.status !== "VOID" ||
    !sale.voidedAt ||
    !Number.isFinite(sale.voidedAt.getTime()) ||
    !sale.voidedById ||
    !sale.voidReason?.trim() ||
    !revertedAt ||
    !Number.isFinite(revertedAt.getTime()) ||
    sale.voidedAt <= redemption.usedAt ||
    revertedAt < sale.voidedAt ||
    input.refundIds.length ||
    !redemption.amount?.isPositive() ||
    !redemption.amount.mul(100).isInteger()
  )
    return fail();
  const restores = input.balances.filter((row) => row.kind === "RESTORE" && row.saleId === sale.id);
  const reversals = input.reversals.filter((row) => row.sourceId === event.id);
  if (restores.length !== 1 || reversals.length !== 1) return fail();
  const restore = restores[0];
  const reversal = reversals[0];
  if (
    restore.tenantId !== spend.tenantId ||
    restore.holdingId !== holding.id ||
    !restore.customerId ||
    restore.previousCustomerId !== restore.customerId ||
    restore.previousSharedFamilyId !== restore.sharedFamilyId ||
    restore.actorId !== sale.voidedById ||
    restore.reason !== sale.voidReason ||
    !restore.delta.equals(redemption.amount) ||
    !restore.delta.equals(restore.amountAfter.minus(restore.amountBefore)) ||
    restore.amountBefore.isNegative() ||
    !restore.amountBefore.mul(100).isInteger() ||
    restore.amountAfter.greaterThan(spend.purchase.credit) ||
    (restore.expiresAt?.getTime() ?? null) !==
      ((input.restorationExpiresAt === undefined
        ? holding.expiresAt
        : input.restorationExpiresAt
      )?.getTime() ?? null) ||
    // Balance createdAt is PostgreSQL transaction-start time, not the wall-clock
    // time of the holding UPDATE. It may precede sale.voidedAt in this transaction.
    !Number.isFinite(restore.createdAt.getTime()) ||
    restore.createdAt < redemption.usedAt ||
    restore.createdAt > revertedAt ||
    reversal.sourceType !== "REVERSAL" ||
    reversal.tenantId !== spend.tenantId ||
    reversal.saleId !== sale.id ||
    reversal.outletId !== sale.outletId ||
    reversal.sourceKey !== `void:${sale.id}:${event.id}` ||
    reversal.actorId !== sale.voidedById ||
    reversal.reason !== "Source sale voided" ||
    !Number.isFinite(reversal.occurredAt.getTime()) ||
    !Number.isFinite(reversal.createdAt.getTime()) ||
    reversal.occurredAt < sale.voidedAt ||
    reversal.occurredAt > revertedAt ||
    reversal.createdAt < reversal.occurredAt ||
    event.createdAt > reversal.occurredAt
  )
    return fail();
  // Verify historical economics/rates only after the operational void is proven.
  // Never let callers normalize an unsupported status inside the active verifier.
  const verified = verifyPayrollValueSpend({
    ...spend,
    sale: { ...sale, status: "COMPLETED" },
    redemption: { ...redemption, revertedAt: null },
  });
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: spend.timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(reversal.occurredAt);
  const resolved = resolvePayrollCloseSources({
    tenantId: spend.tenantId,
    timeZone: spend.timeZone,
    periodKey: ["year", "month"]
      .map((type) => parts.find((row) => row.type === type)!.value)
      .join("-"),
    events: [reversal as Parameters<typeof resolvePayrollCloseSources>[0]["events"][number]],
    lineageEvents: [event],
  });
  if (!resolved.sources) return fail();
  return {
    ...verified,
    restorationBalanceId: restore.id,
    reversalEventId: reversal.id,
  };
}
