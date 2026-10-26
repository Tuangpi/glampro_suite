import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { commissionEventSchema, type CommissionEvent } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { badRequest, conflict } from "../lib/http-error.js";
import { lockCommissionConfiguration } from "./commission.service.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Cents × rate basis points × split basis points / 10^10, exactly (no line rounding). */
export function commissionAmount(basis: string, rate: string, share: number): string {
  const parsed = commissionEventSchema.shape.basis.parse(basis);
  commissionEventSchema.shape.rate.parse(rate);
  commissionEventSchema.shape.share.parse(share);
  const units = BigInt(parsed.replace(".", "")) * BigInt(rate.replace(".", "")) * BigInt(share);
  return `${units / 10000000000n}.${(units % 10000000000n).toString().padStart(10, "0")}`;
}

/** Round once after grouping by staff/type/currency/period, including negative adjustments. */
export function commissionSubtotal(amounts: string[]): string {
  return amounts
    .reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

async function context(tx: Transaction, actorId: string) {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw badRequest("Commission posting requires salon scope.");
  if (scope.actorId && scope.actorId !== actorId) throw badRequest("Commission actor mismatch.");
  // Same lock order for publication, period changes, postings and reversal retries.
  await lockCommissionConfiguration(tx, scope.tenantId);
  const actor = await tx.user.findFirst({ where: { id: actorId, disabled: false } });
  if (!actor) throw badRequest("A current enabled salon actor is required.");
  return { tenantId: scope.tenantId, actor };
}

async function openPeriod(tx: Transaction, periodId: string, at: Date) {
  const period = await tx.commissionPeriod.findFirst({ where: { id: periodId } });
  if (!period || period.lockedAt || at < period.startsAt || at >= period.endsAt)
    throw conflict("Posting requires an open period containing the posting time.");
  return period;
}

/** Internal primitive: callers must authorize the source operation and pass its transaction.
 * No public route or POS integration is enabled by this foundation.
 */
export async function postCommission(tx: Transaction, value: CommissionEvent) {
  const input = commissionEventSchema.parse(value);
  const { tenantId, actor } = await context(tx, input.actorId);
  if (input.sourceType === "MANUAL" && !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole))
    throw badRequest("Manual adjustments require a salon administrator or manager.");
  const eventHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const existing = await tx.employeeCommission.findFirst({ where: { eventKey: input.eventKey } });
  if (existing) {
    if (existing.eventHash !== eventHash)
      throw conflict("Commission event key has different evidence.");
    return existing;
  }
  const at = new Date(input.occurredAt);
  await openPeriod(tx, input.periodId, at);
  if (!(await tx.user.findFirst({ where: { id: input.userId, disabled: false } })))
    throw badRequest("Credited staff must belong to this salon and be enabled.");
  if (input.saleId && !(await tx.sale.findFirst({ where: { id: input.saleId } })))
    throw badRequest("Commission sale does not belong to this salon.");
  if (
    input.saleLineId &&
    !(await tx.saleLine.findFirst({ where: { id: input.saleLineId, saleId: input.saleId ?? "" } }))
  )
    throw badRequest("Commission line does not belong to the source sale.");
  return tx.employeeCommission.create({
    data: {
      tenantId,
      userId: input.userId,
      saleId: input.saleId,
      saleLineId: input.saleLineId,
      ledgerVersion: 1,
      eventKey: input.eventKey,
      eventHash,
      kind: input.kind,
      entryType: input.sourceType === "MANUAL" ? "ADJUSTMENT" : "EARNING",
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      occurredAt: at,
      periodId: input.periodId,
      currency: input.currency,
      share: input.share,
      actorId: input.actorId,
      reason: input.reason,
      snapshot: input,
      basis: input.basis,
      rate: input.rate,
      ruleId: input.ruleId,
      ruleSource: input.ruleSource,
      amount: commissionAmount(input.basis, input.rate, input.share),
    },
  });
}

/** Exact full reversal. Partial refunds use source-allocation deltas in SC-006. */
export async function reverseCommission(
  tx: Transaction,
  input: {
    originalId: string;
    eventKey: string;
    actorId: string;
    reason: string;
    periodId: string;
  },
) {
  commissionEventSchema.shape.eventKey.parse(input.eventKey);
  commissionEventSchema.shape.reason.parse(input.reason);
  const { tenantId, actor } = await context(tx, input.actorId);
  if (!["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole))
    throw badRequest("Commission reversals require a salon administrator or manager.");
  const eventHash = createHash("sha256")
    .update(
      JSON.stringify([
        input.originalId,
        input.eventKey,
        input.actorId,
        input.reason,
        input.periodId,
      ]),
    )
    .digest("hex");
  const existing = await tx.employeeCommission.findFirst({ where: { eventKey: input.eventKey } });
  if (existing) {
    if (existing.eventHash !== eventHash)
      throw conflict("Reversal event key has different evidence.");
    return existing;
  }
  const original = await tx.employeeCommission.findFirst({
    where: { id: input.originalId, ledgerVersion: 1 },
  });
  if (!original || original.entryType === "REVERSAL")
    throw badRequest("Original earning not found.");
  if (await tx.employeeCommission.findFirst({ where: { reversesId: original.id } }))
    throw conflict("Commission has already been reversed.");
  const now = new Date();
  await openPeriod(tx, input.periodId, now);
  return tx.employeeCommission.create({
    data: {
      tenantId,
      userId: original.userId,
      saleId: original.saleId,
      saleLineId: original.saleLineId,
      ledgerVersion: 1,
      eventKey: input.eventKey,
      eventHash,
      kind: original.kind,
      entryType: "REVERSAL",
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      occurredAt: now,
      periodId: input.periodId,
      currency: original.currency,
      share: original.share,
      actorId: input.actorId,
      reason: input.reason,
      snapshot: original.snapshot as Prisma.InputJsonValue,
      reversesId: original.id,
      basis: original.basis?.negated(),
      rate: original.rate,
      ruleId: original.ruleId,
      ruleSource: original.ruleSource,
      amount: original.amount.negated(),
    },
  });
}
