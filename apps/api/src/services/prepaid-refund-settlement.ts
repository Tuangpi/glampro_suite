import { z } from "zod";
import type { RefundPayrollPackage } from "@glampro_suite/shared";
import { conflict, forbidden } from "../lib/http-error.js";
import { currentScope, currentOutletId } from "../lib/tenant-context.js";
import { payrollInputHash } from "./payroll-close-state.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const normalize = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as Record<string, unknown>;

/** Internal transactional writer. Records a confirmed actual payout, never sends
 * funds. Missing confirmation remains a legacy capture, not settlement evidence. */
export async function recordPrepaidRefundSettlement(
  tx: PayrollCloseTransaction,
  input: RefundPayrollPackage,
  facts: {
    sourceKey: string;
    requestHash: string;
    holdingId: string;
    itemType: "PACKAGE" | "VALUE_PACKAGE";
    saleId: string;
    saleLineId: string;
    actorId: string;
    actorRole: string;
    occurredAt: Date;
    netCents: bigint;
    taxCents: bigint;
    cancelledGrossCents: bigint;
    evidence: unknown;
  },
) {
  if (!input.settlement) return;
  const scope = currentScope();
  if (scope?.kind !== "tenant" || scope.actorId !== facts.actorId || currentOutletId())
    throw forbidden("Prepaid refund settlement requires a salon-wide authenticated manager.");
  const actor = await tx.user.findFirst({
    where: { tenantId: scope.tenantId, id: facts.actorId, disabled: false },
  });
  if (
    !actor ||
    actor.globalRole !== facts.actorRole ||
    !["MANAGER", "SUPER_ADMIN"].includes(actor.globalRole) ||
    (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
  )
    throw forbidden("Prepaid refund settlement requires an authorized manager.");
  const grossCents = facts.netCents + facts.taxCents;
  if (
    grossCents.toString() !== input.payoutGrossCents ||
    facts.netCents < 0n ||
    facts.taxCents < 0n ||
    facts.cancelledGrossCents < 0n ||
    (grossCents === 0n) !== (input.payoutMethod === "NONE")
  )
    throw conflict("Prepaid refund settlement money does not reconcile.");
  const evidence = normalize({ version: 1, request: input, operational: facts.evidence });
  return tx.prepaidRefundSettlement.create({
    data: {
      tenantId: scope.tenantId,
      sourceKey: facts.sourceKey,
      holdingId: facts.holdingId,
      itemType: facts.itemType,
      saleId: facts.saleId,
      saleLineId: facts.saleLineId,
      actorId: facts.actorId,
      actorRole: actor.globalRole,
      reason: input.reason,
      reference: input.settlement.reference,
      requestHash: facts.requestHash,
      currency: "SGD",
      payoutMethod: input.payoutMethod,
      netCents: facts.netCents,
      taxCents: facts.taxCents,
      grossCents,
      cancelledGrossCents: facts.cancelledGrossCents,
      occurredAt: facts.occurredAt,
      evidence: { ...evidence, operationalHash: payrollInputHash(evidence.operational) },
    },
  });
}

/** Retry cannot create missing historical settlement or accept a changed journal. */
export async function verifyPrepaidRefundSettlementRetry(
  tx: PayrollCloseTransaction,
  input: RefundPayrollPackage,
  sourceKey: string,
  requestHash: string,
) {
  if (!input.settlement) return;
  const scope = currentScope();
  if (scope?.kind !== "tenant" || !scope.actorId || currentOutletId())
    throw forbidden("Prepaid refund settlement requires a salon-wide authenticated manager.");
  const actor = await tx.user.findFirst({
    where: { tenantId: scope.tenantId, id: scope.actorId, disabled: false },
  });
  if (
    !actor ||
    !["MANAGER", "SUPER_ADMIN"].includes(actor.globalRole) ||
    (actor.globalRole === "SUPER_ADMIN" && !actor.twoFactorEnabled)
  )
    throw forbidden("Prepaid refund settlement requires an authorized manager.");
  const row = await tx.prepaidRefundSettlement.findFirst({
    where: { tenantId: scope.tenantId, sourceKey },
  });
  const evidence = z
    .object({ request: z.unknown(), operational: z.unknown(), operationalHash: z.string() })
    .safeParse(row?.evidence);
  if (
    !row ||
    row.tenantId !== scope.tenantId ||
    row.sourceKey !== sourceKey ||
    row.requestHash !== requestHash ||
    row.actorId !== scope.actorId ||
    row.reference !== input.settlement.reference ||
    !evidence.success ||
    payrollInputHash(evidence.data.request) !== payrollInputHash(input) ||
    payrollInputHash(evidence.data.operational) !== evidence.data.operationalHash
  )
    throw conflict("Original prepaid refund settlement evidence is unavailable.");
}
