import { z } from "zod";
import { payrollPeriodKeySchema } from "@glampro_suite/shared";
import { conflict } from "../lib/http-error.js";
import { salonDayBounds } from "../lib/wall-clock.js";
import { payrollInputHash } from "./payroll-close-state.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

const period = z.object({
  periodKey: payrollPeriodKeySchema,
  revision: z.number().int().safe().nonnegative(),
  status: z.enum(["OPEN", "CALCULATED", "APPROVED"]),
  stateHash: z.string().nullable(),
});
export const payrollCorrectionPostingSchema = z.object({
  version: z.literal(1),
  correctionAt: z.iso.datetime(),
  postingAt: z.iso.datetime(),
  originalPeriodKey: payrollPeriodKeySchema,
  periodKey: payrollPeriodKeySchema,
  inspectedPeriods: z.array(period).min(1),
});
export type PayrollCorrectionPosting = z.infer<typeof payrollCorrectionPostingSchema>;
const month = (at: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  return ["year", "month"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
};
const following = (key: string) => {
  const [year, number] = key.split("-").map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
};
const fail = (): never => {
  throw conflict("Payroll correction posting evidence is inconsistent.");
};

/** Caller holds prepaid then configuration locks, shared with close approval.
 * An absent close is explicitly OPEN revision zero, as in the close store.
 * Occurrence remains in the operational snapshot; only source posting is deferred. */
export async function selectPayrollCorrectionPosting(
  tx: PayrollCloseTransaction,
  tenantId: string,
  originalAt: Date,
  correctionAt: Date,
): Promise<PayrollCorrectionPosting> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timeZone: true },
  });
  const originalPeriodKey = month(originalAt, tenant.timeZone);
  let key = month(correctionAt, tenant.timeZone);
  if (correctionAt < originalAt) return fail();
  const inspectedPeriods: PayrollCorrectionPosting["inspectedPeriods"] = [];
  // Bounded by the complete persisted close inventory, never an arbitrary month limit.
  const closes = await tx.payrollClose.findMany({ where: { tenantId, periodKey: { gte: key } } });
  for (let index = 0; index <= closes.length; index++) {
    const close = closes.find((row) => row.periodKey === key);
    if (close) {
      const audit = await tx.payrollCloseEvent.findFirst({
        where: { tenantId, periodKey: key, revision: close.revision },
      });
      const state = close.state as { periodKey?: unknown; revision?: unknown; status?: unknown };
      if (
        !audit ||
        audit.stateHash !== payrollInputHash(close.state) ||
        audit.stateHash !== payrollInputHash(audit.state) ||
        state.periodKey !== key ||
        state.revision !== close.revision ||
        state.status !== close.status
      )
        return fail();
      inspectedPeriods.push({
        periodKey: key,
        revision: close.revision,
        status: period.shape.status.parse(close.status),
        stateHash: audit.stateHash,
      });
    } else inspectedPeriods.push({ periodKey: key, revision: 0, status: "OPEN", stateHash: null });
    if (!close || close.status !== "APPROVED") {
      return {
        version: 1,
        originalPeriodKey,
        periodKey: key,
        correctionAt: correctionAt.toISOString(),
        postingAt: new Date(
          Math.max(
            correctionAt.getTime(),
            salonDayBounds(`${key}-01`, tenant.timeZone).from.getTime(),
          ),
        ).toISOString(),
        inspectedPeriods,
      };
    }
    key = following(key);
  }
  return fail();
}

/** Reconcile selection against immutable historical close audits, not today's
 * revision (which may now be calculated/approved). Revision-zero absence is
 * checked against the first persisted audit. */
export async function verifyPayrollCorrectionPosting(
  tx: PayrollCloseTransaction,
  tenantId: string,
  originalAt: Date,
  raw: unknown,
) {
  const parsed = payrollCorrectionPostingSchema.safeParse(raw);
  if (!parsed.success) return fail();
  const posting = parsed.data;
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timeZone: true },
  });
  const at = new Date(posting.correctionAt);
  let key = month(at, tenant.timeZone);
  if (at < originalAt || posting.originalPeriodKey !== month(originalAt, tenant.timeZone))
    return fail();
  for (const [index, inspected] of posting.inspectedPeriods.entries()) {
    const last = index === posting.inspectedPeriods.length - 1;
    if (
      inspected.periodKey !== key ||
      (last ? inspected.status === "APPROVED" : inspected.status !== "APPROVED")
    )
      return fail();
    if (inspected.revision === 0) {
      if (!last || inspected.stateHash !== null || inspected.status !== "OPEN") return fail();
      const first = await tx.payrollCloseEvent.findFirst({
        where: { tenantId, periodKey: key },
        orderBy: { revision: "asc" },
      });
      if (first && first.createdAt < at) return fail();
    } else {
      const audit = await tx.payrollCloseEvent.findFirst({
        where: { tenantId, periodKey: key, revision: inspected.revision },
      });
      if (
        !audit ||
        audit.stateHash !== inspected.stateHash ||
        audit.stateHash !== payrollInputHash(audit.state)
      )
        return fail();
      const state = audit.state as { periodKey?: unknown; revision?: unknown; status?: unknown };
      if (
        state.periodKey !== key ||
        state.revision !== inspected.revision ||
        state.status !== inspected.status
      )
        return fail();
    }
    if (!last) key = following(key);
  }
  if (
    posting.periodKey !== key ||
    posting.postingAt !==
      new Date(
        Math.max(at.getTime(), salonDayBounds(`${key}-01`, tenant.timeZone).from.getTime()),
      ).toISOString()
  )
    return fail();
  return posting;
}
