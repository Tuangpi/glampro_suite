import {
  payrollAssignmentSchema,
  payrollPlanVersionSchema,
  payrollSettingsSchema,
  payrollBusinessDateSchema,
  resolvePayrollPlan,
} from "@glampro_suite/shared";
import { z } from "zod";
import { salonDayBounds } from "../lib/wall-clock.js";

/** Last completed calendar month, not an approved or frozen payroll statement. */
export function payrollPreviewWindow(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const current = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
  const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  return {
    periodKey: previous,
    timeZone,
    from: salonDayBounds(`${previous}-01`, timeZone).from,
    to: salonDayBounds(current, timeZone).from,
  };
}

interface ConfigurationEvent {
  id: string;
  kind: string;
  targetId: string;
  revision: number;
  createdAt: Date;
  payload: unknown;
}
const staffEvidence = z.object({
  joinDate: payrollBusinessDateSchema,
  stageEndOverride: z.number().int().min(1).nullable(),
});

/** Authorized DB records only. Never substitute present-day employment data for old audit. */
export function resolvePayrollPreviewConfiguration(input: {
  planId: string;
  periodKey: string;
  endsAt: Date;
  events: ConfigurationEvent[];
  versions: unknown[];
  staff: { id: string; name: string; disabled: boolean }[];
}) {
  const latest = (kind: string, targetId: string, historical = false) =>
    input.events
      .filter(
        (e) =>
          e.kind === kind && e.targetId === targetId && (!historical || e.createdAt < input.endsAt),
      )
      .sort((a, b) => b.revision - a.revision)[0];
  // Assignment replacement events contain the full effective-dated timeline.
  const assignment = latest("ASSIGNMENT", "company");
  const assignments = payrollAssignmentSchema.array().parse(assignment?.payload ?? []);
  const versions = input.versions.map((v) => payrollPlanVersionSchema.parse(v));
  const settings = latest("SETTINGS", "company", true);
  const settingsEvidence = payrollSettingsSchema.safeParse(settings?.payload);
  const rows = input.staff.flatMap((staff) => {
    const selected = resolvePayrollPlan(staff.id, input.periodKey, assignments, versions);
    if (selected?.version.planId !== input.planId) return [];
    const event = latest("STAFF", staff.id, true);
    const evidence = staffEvidence.safeParse(event?.payload);
    return [
      {
        staffId: staff.id,
        staffName: staff.name,
        disabled: staff.disabled,
        assignment: selected.assignment,
        version: selected.version,
        staffEventId: event?.id ?? null,
        staffRevision: event?.revision ?? null,
        joinDate: evidence.success ? evidence.data.joinDate : null,
        stageEndOverride: evidence.success ? evidence.data.stageEndOverride : null,
        blockers: evidence.success ? [] : ["HISTORICAL_STAFF_SETTINGS_UNAVAILABLE"],
      },
    ];
  });
  return {
    assignmentRevision: assignment?.revision ?? 0,
    assignmentEventId: assignment?.id ?? null,
    settingsRevision: settings?.revision ?? 0,
    settingsEventId: settings?.id ?? null,
    settings: settingsEvidence.success ? settingsEvidence.data : null,
    blockers: settingsEvidence.success ? [] : ["HISTORICAL_SALON_SETTINGS_UNAVAILABLE"],
    staff: rows,
  };
}
