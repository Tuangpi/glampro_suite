import { z } from "zod";
import { conflict } from "../lib/http-error.js";
import { payrollInputHash } from "./payroll-close-state.js";
import {
  payrollCorrectionPostingSchema,
  selectPayrollCorrectionPosting,
  verifyPayrollCorrectionPosting,
} from "./payroll-correction-posting.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";
import { salonDayBounds } from "../lib/wall-clock.js";

export const PAYROLL_LIFECYCLE_POSTING_ACTION = "payroll.lifecycle.posting";
const schema = z.object({
  version: z.literal(1),
  actorId: z.string(),
  reason: z.string(),
  requestHash: z.string().optional(),
  originalAt: z.iso.datetime(),
  posting: payrollCorrectionPostingSchema,
  events: z.array(z.object({ id: z.string(), hash: z.string() })).min(1),
});
export const lifecycleEventHash = (event: unknown) =>
  payrollInputHash(JSON.parse(JSON.stringify(event)));

/** Caller holds prepaid then configuration locks. Operational captures, payouts,
 * restoration journals and their business dates are deliberately not rewritten. */
export async function recordPayrollLifecyclePosting(
  tx: PayrollCloseTransaction,
  input: {
    tenantId: string;
    actorId: string;
    reason: string;
    targetId: string;
    originalAt: Date;
    occurredAt: Date;
    eventIds: string[];
    request?: unknown;
  },
) {
  if (!input.eventIds.length) return;
  const posting = await selectPayrollCorrectionPosting(
    tx,
    input.tenantId,
    input.originalAt,
    input.occurredAt,
  );
  if (posting.postingAt === posting.correctionAt) return;
  const events = await tx.payrollSourceEvent.findMany({
    where: { tenantId: input.tenantId, id: { in: input.eventIds } },
    orderBy: { id: "asc" },
  });
  if (events.length !== input.eventIds.length)
    throw conflict("Lifecycle payroll posting captures are incomplete.");
  await tx.auditLog.create({
    data: {
      tenantId: input.tenantId,
      action: PAYROLL_LIFECYCLE_POSTING_ACTION,
      targetType: "PayrollLifecycleCorrection",
      targetId: input.targetId,
      createdAt: input.occurredAt,
      metadata: {
        version: 1,
        actorId: input.actorId,
        reason: input.reason,
        ...(input.request === undefined ? {} : { requestHash: payrollInputHash(input.request) }),
        originalAt: input.originalAt.toISOString(),
        posting,
        events: events.map((event) => ({ id: event.id, hash: lifecycleEventHash(event) })),
      },
    },
  });
}

/** Preserve legacy first-receipt semantics for non-deferred operations; a deferred
 * retry must identify the exact same request, not silently replace its intent. */
export async function verifyPayrollLifecycleRetry(
  tx: Pick<PayrollCloseTransaction, "auditLog">,
  tenantId: string,
  targetId: string,
  actorId: string,
  request: unknown,
) {
  const audits = await tx.auditLog.findMany({
    where: { tenantId, action: PAYROLL_LIFECYCLE_POSTING_ACTION, targetId },
  });
  if (!audits.length) return;
  if (audits.length !== 1) throw conflict("Lifecycle payroll retry audit is inconsistent.");
  const evidence = schema.parse(audits[0].metadata);
  if (evidence.actorId !== actorId || evidence.requestHash !== payrollInputHash(request))
    throw conflict("Lifecycle payroll retry has different evidence.");
}

/** Independent inventory: missing or moved captures cannot hide a deferred correction. */
export async function loadPayrollLifecyclePostings(tx: PayrollCloseTransaction, tenantId: string) {
  const rows = await tx.auditLog.findMany({
    where: { tenantId, action: PAYROLL_LIFECYCLE_POSTING_ACTION },
    orderBy: { id: "asc" },
  });
  const seen = new Set<string>();
  const loaded = await Promise.all(
    rows.map(async (row) => {
      const evidence = schema.parse(row.metadata);
      if (row.createdAt.toISOString() !== evidence.posting.correctionAt || !row.targetId)
        throw conflict("Lifecycle payroll posting audit is inconsistent.");
      await verifyPayrollCorrectionPosting(
        tx,
        tenantId,
        new Date(evidence.originalAt),
        evidence.posting,
      );
      const events = await tx.payrollSourceEvent.findMany({
        where: { tenantId, id: { in: evidence.events.map((event) => event.id) } },
        orderBy: { id: "asc" },
      });
      if (events.length !== evidence.events.length)
        throw conflict("Lifecycle payroll posting capture missing.");
      for (const event of events) {
        if (
          seen.has(event.id) ||
          !["REVERSAL", "PACKAGE_REFUND", "VALUE_PACKAGE_REFUND"].includes(event.sourceType) ||
          event.actorId !== evidence.actorId ||
          lifecycleEventHash(event) !==
            evidence.events.find((part) => part.id === event.id)?.hash ||
          payrollInputHash(
            z
              .object({ payrollLifecyclePosting: payrollCorrectionPostingSchema })
              .parse(event.evidence).payrollLifecyclePosting,
          ) !== payrollInputHash(evidence.posting)
        )
          throw conflict("Lifecycle payroll posting capture is inconsistent.");
        seen.add(event.id);
      }
      const saleIds = [...new Set(events.map((event) => event.saleId))];
      if (saleIds.length !== 1) throw conflict("Lifecycle payroll posting sale is inconsistent.");
      const sale = await tx.sale.findFirst({ where: { tenantId, id: saleIds[0] } });
      if (!sale || sale.soldAt.toISOString() !== evidence.originalAt)
        throw conflict("Lifecycle payroll posting original date is inconsistent.");
      let operationEvidence: unknown = null;
      if (events[0].sourceType === "REVERSAL") {
        const isVoid = row.targetId === `void:${sale.id}`;
        const refund = isVoid
          ? null
          : await tx.saleRefund.findFirst({ where: { tenantId, saleId: sale.id } });
        const occurredAt = isVoid ? sale.voidedAt : refund?.refundedAt;
        if (
          (!isVoid && row.targetId !== `refund:${sale.id}`) ||
          occurredAt?.toISOString() !== evidence.posting.correctionAt ||
          (isVoid ? sale.voidedById : refund?.refundedById) !== evidence.actorId ||
          (isVoid ? sale.voidReason : refund?.reason) !== evidence.reason ||
          events.some((event) => !event.sourceKey.startsWith(`${row.targetId}:`))
        )
          throw conflict("Lifecycle payroll posting operation is inconsistent.");
        const complete = await tx.payrollSourceEvent.findMany({
          where: {
            tenantId,
            saleId: sale.id,
            sourceType: "REVERSAL",
            sourceKey: { startsWith: `${row.targetId}:` },
          },
        });
        if (complete.length !== events.length)
          throw conflict("Lifecycle payroll posting inventory is incomplete.");
        // Future posting must not bypass the operational family's independent
        // reconciliation merely because its occurrence falls outside this close.
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { timeZone: true },
        });
        if (isVoid) {
          const usages = await tx.customerRedemption.findMany({
            where: { tenantId, saleId: sale.id },
          });
          const lines = await tx.saleLine.findMany({ where: { tenantId, saleId: sale.id } });
          if (usages.length) {
            const { loadPayrollValueSaleAllocation } =
              await import("./payroll-close-value-sale.js");
            if (usages.some((usage) => usage.itemType === "VALUE_PACKAGE"))
              operationEvidence = await loadPayrollValueSaleAllocation(tx, sale.id);
            else {
              const { loadPayrollSalePackageCoverage } =
                await import("./payroll-close-sale-coverage.js");
              operationEvidence = await loadPayrollSalePackageCoverage(tx, sale.id);
            }
          } else if (lines.some((line) => ["PACKAGE", "VALUE_PACKAGE"].includes(line.itemType))) {
            const { loadPayrollPurchaseSaleVoid } =
              await import("./payroll-close-purchase-void-loader.js");
            operationEvidence = await loadPayrollPurchaseSaleVoid(
              tx,
              tenantId,
              sale.id,
              tenant.timeZone,
            );
          } else {
            const { loadPayrollOrdinarySaleVoid } =
              await import("./payroll-close-sale-void-loader.js");
            operationEvidence = await loadPayrollOrdinarySaleVoid(
              tx,
              tenantId,
              sale.id,
              tenant.timeZone,
            );
          }
        } else {
          const { loadPayrollSaleRefund } = await import("./payroll-close-sale-refund-loader.js");
          const key = evidence.posting.inspectedPeriods[0].periodKey;
          const [year, month] = key.split("-").map(Number);
          operationEvidence = await loadPayrollSaleRefund(tx, {
            tenantId,
            timeZone: tenant.timeZone,
            periodKey: key,
            refund: refund!,
            from: salonDayBounds(`${key}-01`, tenant.timeZone).from,
            to: salonDayBounds(
              `${new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7)}-01`,
              tenant.timeZone,
            ).from,
          });
        }
      } else {
        const settlement = await tx.prepaidRefundSettlement.findFirst({
          where: { tenantId, sourceKey: row.targetId },
        });
        if (
          !settlement ||
          events.length !== 1 ||
          events[0].sourceKey !== row.targetId ||
          events[0].occurredAt.toISOString() !== evidence.posting.correctionAt ||
          settlement.occurredAt.toISOString() !== evidence.posting.correctionAt
        )
          throw conflict("Lifecycle payroll posting refund is inconsistent.");
      }
      return { auditId: row.id, ...evidence, captures: events, operationEvidence };
    }),
  );
  const candidates = await tx.payrollSourceEvent.findMany({
    where: {
      tenantId,
      sourceType: { in: ["REVERSAL", "PACKAGE_REFUND", "VALUE_PACKAGE_REFUND"] },
    },
  });
  const marked = candidates.filter(
    (event) =>
      z
        .object({ payrollLifecyclePosting: payrollCorrectionPostingSchema })
        .safeParse(event.evidence).success ||
      (typeof event.evidence === "object" &&
        event.evidence !== null &&
        "payrollLifecyclePosting" in event.evidence),
  );
  if (marked.some((event) => !seen.has(event.id)))
    throw conflict("Lifecycle payroll posting audit missing.");
  return loaded;
}
