import { z } from "zod";
import { payrollPeriodKeySchema } from "@glampro_suite/shared";
import { salonDayBounds } from "../lib/wall-clock.js";

const id = z.string().trim().min(1).max(128);
const periodSchema = z.object({
  id,
  tenantId: id,
  periodKey: payrollPeriodKeySchema,
  status: z.enum(["OPEN", "CALCULATED", "APPROVED"]),
  revision: z.number().int().safe().nonnegative(),
});
export interface PayrollCorrectionPeriodRecords {
  tenantId: string;
  timeZone: string;
  originalPeriodKey: string;
  correctionAt: Date;
  /** Include the original approved period and every month searched. Absence is
   * unavailable, not permission to create a new period or skip a missing month. */
  periods: z.input<typeof periodSchema>[];
}

function localMonth(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  return ["year", "month"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}
function followingMonth(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
}

/** Internal allocation evidence only. The persistence layer must recheck all
 * returned revisions while holding the same lock as approval and source posting.
 * Never mutates an approved statement or backdates a correction before it happened. */
export function resolvePayrollCorrectionPeriod(raw: PayrollCorrectionPeriodRecords) {
  const tenantId = id.parse(raw.tenantId);
  const originalPeriodKey = payrollPeriodKeySchema.parse(raw.originalPeriodKey);
  const correctionAt = z.date().parse(raw.correctionAt);
  const correctionMonth = localMonth(correctionAt, raw.timeZone);
  const periods = z.array(periodSchema).parse(raw.periods);
  if (periods.some((row) => row.tenantId !== tenantId))
    throw new Error("Correction period evidence contains another salon's period.");
  if (
    new Set(periods.map((row) => row.id)).size !== periods.length ||
    new Set(periods.map((row) => row.periodKey)).size !== periods.length
  )
    throw new Error("Duplicate correction period identities or months.");
  const byMonth = new Map(periods.map((row) => [row.periodKey, row]));
  const inspected: z.infer<typeof periodSchema>[] = [];
  const unavailable = (code: string, periodKey: string) => ({
    status: "UNAVAILABLE" as const,
    earningsActive: false as const,
    blockers: [{ code, periodKey }],
    allocation: null,
  });
  const original = byMonth.get(originalPeriodKey);
  if (!original || original.status !== "APPROVED")
    return unavailable("ORIGINAL_APPROVED_PERIOD_UNAVAILABLE", originalPeriodKey);
  if (correctionMonth < originalPeriodKey)
    return unavailable("CORRECTION_PREDATES_ORIGINAL_PERIOD", correctionMonth);
  inspected.push(original);
  let key =
    correctionMonth > originalPeriodKey ? correctionMonth : followingMonth(originalPeriodKey);
  // Each iteration consumes a distinct supplied month; missing months always stop.
  for (let count = 0; count <= periods.length; count++) {
    const period = byMonth.get(key);
    if (!period) return unavailable("NEXT_PERIOD_EVIDENCE_UNAVAILABLE", key);
    inspected.push(period);
    if (period.status !== "APPROVED") {
      const startsAt = salonDayBounds(`${key}-01`, raw.timeZone).from;
      return structuredClone({
        status: "CORRECTION_PERIOD_EVIDENCE_READY" as const,
        earningsActive: false as const,
        blockers: [],
        allocation: {
          originalPeriodKey,
          correctionAt: correctionAt.toISOString(),
          periodKey: key,
          periodId: period.id,
          expectedRevision: period.revision,
          invalidateCalculation: period.status === "CALCULATED",
          postingAt: new Date(Math.max(startsAt.getTime(), correctionAt.getTime())).toISOString(),
          inspectedPeriods: inspected,
        },
      });
    }
    key = followingMonth(key);
  }
  return unavailable("NEXT_PERIOD_EVIDENCE_UNAVAILABLE", key);
}
