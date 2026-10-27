import { z } from "zod";
import {
  payrollBusinessDateSchema,
  payrollPeriodKeySchema,
  payrollPlanDefinitionSchema,
  payrollStageSchema,
  type PayrollStage,
} from "./contracts.js";

export function payrollMonthEnd(periodKey: string): string {
  payrollPeriodKeySchema.parse(periodKey);
  const [year, month] = periodKey.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${periodKey}-${String(day).padStart(2, "0")}`;
}

export function payrollTenureMonth(
  joinDate: string,
  periodKey: string,
  joinAfterDay: number | null = null,
): number {
  payrollBusinessDateSchema.parse(joinDate);
  payrollPeriodKeySchema.parse(periodKey);
  if (joinAfterDay !== null) z.number().int().min(1).max(31).parse(joinAfterDay);
  const [year, month, day] = joinDate.split("-").map(Number);
  const [periodYear, periodMonth] = periodKey.split("-").map(Number);
  return (
    (periodYear - year) * 12 +
    periodMonth -
    month +
    1 -
    (joinAfterDay !== null && day > joinAfterDay ? 1 : 0)
  );
}

export function resolvePayrollStage(
  stages: PayrollStage[],
  month: number | null,
  stageEndOverride?: number | null,
): PayrollStage {
  stages.forEach((stage) => payrollStageSchema.parse(stage));
  if (!stages.length) return { key: "std", name: "Standard", fromMonth: 1, toMonth: null };
  if (month === null) throw new Error("A staged plan requires an evidenced join date.");
  if (!Number.isInteger(month) || month < 0) throw new Error("Period precedes employment.");
  const sorted = [...stages].sort((a, b) => a.fromMonth - b.fromMonth);
  if (stageEndOverride !== undefined && stageEndOverride !== null) {
    z.number().int().min(0).max(1200).parse(stageEndOverride);
    if (sorted.length !== 2) throw new Error("Stage-end override requires a two-stage plan.");
    return month <= stageEndOverride ? sorted[0] : sorted[1];
  }
  // A deferred join-month (month 0) uses the first stage, never standard rates.
  const hit = sorted.find(
    (stage) => month >= stage.fromMonth && (stage.toMonth === null || month <= stage.toMonth),
  );
  if (month === 0) return sorted[0];
  if (!hit) throw new Error("No stage covers this tenure month.");
  return hit;
}

export function payrollStageSchedule(
  stages: PayrollStage[],
  joinDate: string,
  joinAfterDay: number | null = null,
) {
  payrollTenureMonth(joinDate, joinDate.slice(0, 7), joinAfterDay);
  const [year, month, day] = joinDate.split("-").map(Number);
  const origin = year * 12 + month - 1 + (joinAfterDay !== null && day > joinAfterDay ? 1 : 0);
  const monthKey = (index: number) =>
    `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  return stages.map((stage) => {
    payrollStageSchema.parse(stage);
    return {
      stageKey: stage.key,
      from: monthKey(origin + stage.fromMonth - 1),
      to: stage.toMonth === null ? null : monthKey(origin + stage.toMonth - 1),
    };
  });
}

export const payrollAssignmentSchema = z
  .strictObject({
    id: z.string().min(1),
    staffId: z.string().min(1),
    planId: z.string().min(1),
    fromDate: payrollBusinessDateSchema,
    toDate: payrollBusinessDateSchema.nullable(),
  })
  .refine(
    (row) => row.toDate === null || row.toDate >= row.fromDate,
    "Assignment end precedes start.",
  );
export const payrollPlanVersionSchema = z.strictObject({
  id: z.string().min(1),
  planId: z.string().min(1),
  versionNo: z.number().int().min(1),
  effectiveFrom: payrollBusinessDateSchema,
  status: z.enum(["DRAFT", "PUBLISHED"]),
  definition: payrollPlanDefinitionSchema,
});
export type PayrollAssignment = z.infer<typeof payrollAssignmentSchema>;
export type PayrollPlanVersion = z.infer<typeof payrollPlanVersionSchema>;

/** Inputs must already be authorized tenant/outlet records; this grants no access. */
export function resolvePayrollPlan(
  staffId: string,
  periodKey: string,
  assignments: PayrollAssignment[],
  versions: PayrollPlanVersion[],
) {
  const end = payrollMonthEnd(periodKey);
  const parsed = assignments.map((row) => payrollAssignmentSchema.parse(row));
  const staffAssignments = parsed
    .filter((row) => row.staffId === staffId)
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  for (let i = 1; i < staffAssignments.length; i++)
    if (
      staffAssignments[i - 1].toDate === null ||
      staffAssignments[i].fromDate <= staffAssignments[i - 1].toDate!
    )
      throw new Error("Overlapping plan assignments.");
  const assignment = staffAssignments.find(
    (row) => row.fromDate <= end && (row.toDate === null || row.toDate >= end),
  );
  if (!assignment) return null;
  const published = versions
    .map((row) => payrollPlanVersionSchema.parse(row))
    .filter((row) => row.planId === assignment.planId && row.status === "PUBLISHED")
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  if (
    new Set(published.map((row) => row.effectiveFrom)).size !== published.length ||
    new Set(published.map((row) => row.versionNo)).size !== published.length
  )
    throw new Error("Ambiguous published plan versions.");
  const version = published.find((row) => row.effectiveFrom <= end);
  if (!version) throw new Error("Assigned plan has no effective published version.");
  return { assignment, version };
}
