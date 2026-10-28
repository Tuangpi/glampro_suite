import { z } from "zod";
import {
  payrollAssignmentSchema,
  payrollBusinessDateSchema,
  payrollPeriodKeySchema,
  payrollPlanVersionSchema,
  payrollProfileSchema,
  payrollSettingsSchema,
  resolvePayrollPlan,
} from "@glampro_suite/shared";
import { salonDayBounds } from "../lib/wall-clock.js";

const id = z.string().trim().min(1).max(128);
const eventSchema = z.object({
  id,
  tenantId: id,
  kind: z.enum(["PLAN", "ASSIGNMENT", "STAFF", "PROFILE", "SETTINGS"]),
  targetId: id,
  revision: z.number().int().positive().safe(),
  createdAt: z.date(),
  payload: z.unknown(),
});
const staffSettingsSchema = z.object({
  joinDate: payrollBusinessDateSchema,
  stageEndOverride: z.number().int().min(0).max(1200).nullable(),
  commissionRole: z.enum(["COMMISSION_EARNING", "NON_COMMISSION"]),
});
export interface PayrollCloseConfigurationRecords {
  tenantId: string;
  periodKey: string;
  timeZone: string;
  events: z.input<typeof eventSchema>[];
  versions: (z.input<typeof payrollPlanVersionSchema> & { tenantId: string })[];
  staff: { tenantId: string; id: string; name: string; disabled: boolean }[];
  /** Union of staff with source activity, frozen carry, manual amounts or other amounts owed.
   * The authoritative loader supplies these IDs, including departed/disabled staff. */
  requiredStaffIds: string[];
}
export interface PayrollConfigurationBlocker {
  code: string;
  staffId: string | null;
  eventId: string | null;
}

/** Internal record resolver, not an authorization boundary or a complete payroll input loader.
 * Never reads a DB, substitutes current salary/employment values, or invents zero profiles.
 * Historical profiles/settings use their existing append-only event timestamp; assignments
 * use the latest complete effective-dated timeline, matching the configuration preview.
 */
export function resolvePayrollCloseConfiguration(raw: PayrollCloseConfigurationRecords) {
  const tenantId = id.parse(raw.tenantId);
  const periodKey = payrollPeriodKeySchema.parse(raw.periodKey);
  const [year, month] = periodKey.split("-").map(Number);
  const from = salonDayBounds(`${periodKey}-01`, raw.timeZone).from;
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const to = salonDayBounds(next, raw.timeZone).from;
  const events = raw.events.map((row) => eventSchema.parse(row));
  const staff = z
    .object({ tenantId: id, id, name: z.string().min(1), disabled: z.boolean() })
    .array()
    .parse(raw.staff)
    .sort((a, b) => a.id.localeCompare(b.id));
  const requiredStaffIds = z.array(id).parse(raw.requiredStaffIds);
  const versions = raw.versions.map((row) => {
    if (row.tenantId !== tenantId)
      throw new Error("Payroll configuration contains another salon's version.");
    const { tenantId: _tenantId, ...version } = row;
    return payrollPlanVersionSchema.parse(version);
  });
  if (
    events.some((row) => row.tenantId !== tenantId) ||
    staff.some((row) => row.tenantId !== tenantId)
  )
    throw new Error("Payroll configuration contains another salon's records.");
  for (const rows of [events, versions, staff]) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new Error("Duplicate payroll configuration record IDs.");
  }
  const eventKeys = events.map((row) => JSON.stringify([row.kind, row.targetId, row.revision]));
  if (new Set(eventKeys).size !== eventKeys.length)
    throw new Error("Ambiguous payroll configuration audit revision.");
  const blockers: PayrollConfigurationBlocker[] = [];
  const block = (code: string, staffId: string | null = null, eventId: string | null = null) => {
    blockers.push({ code, staffId, eventId });
  };
  const latest = (kind: string, targetId: string, historical = true) =>
    events
      .filter(
        (row) =>
          row.kind === kind && row.targetId === targetId && (!historical || row.createdAt < to),
      )
      .sort((a, b) => b.revision - a.revision)[0] ?? null;
  const evidence = (row: (typeof events)[number] | null) =>
    row === null
      ? null
      : {
          ...row,
          createdAt: row.createdAt.toISOString(),
        };
  const settingsEvent = latest("SETTINGS", "company");
  const settings = payrollSettingsSchema.safeParse(settingsEvent?.payload);
  if (!settings.success)
    block("HISTORICAL_SALON_SETTINGS_UNAVAILABLE", null, settingsEvent?.id ?? null);
  const assignmentEvent = latest("ASSIGNMENT", "company", false);
  const assignments = payrollAssignmentSchema.array().safeParse(assignmentEvent?.payload ?? []);
  if (!assignments.success) block("ASSIGNMENT_TIMELINE_INVALID", null, assignmentEvent?.id ?? null);
  const staffIds = new Set(staff.map((row) => row.id));
  for (const staffId of [...new Set(requiredStaffIds)].sort()) {
    if (!staffIds.has(staffId)) block("REQUIRED_STAFF_IDENTITY_UNAVAILABLE", staffId);
  }
  const required = new Set(requiredStaffIds);
  const rows = staff.flatMap((person) => {
    if (person.disabled && !required.has(person.id)) return [];
    const staffEvent = latest("STAFF", person.id);
    const details = staffSettingsSchema.safeParse(staffEvent?.payload);
    // Current account enablement alone does not make a future join eligible for salary.
    if (details.success && details.data.joinDate >= next) {
      if (required.has(person.id))
        block("ACTIVITY_PRECEDES_EMPLOYMENT", person.id, staffEvent?.id ?? null);
      return [];
    }
    if (!details.success)
      block("HISTORICAL_STAFF_SETTINGS_UNAVAILABLE", person.id, staffEvent?.id ?? null);
    const profileEvent = latest("PROFILE", person.id);
    const profile = payrollProfileSchema.safeParse(profileEvent?.payload);
    if (!profile.success)
      block("HISTORICAL_PAYROLL_PROFILE_UNAVAILABLE", person.id, profileEvent?.id ?? null);
    let selected: ReturnType<typeof resolvePayrollPlan> = null;
    if (assignments.success) {
      try {
        selected = resolvePayrollPlan(person.id, periodKey, assignments.data, versions);
      } catch {
        block("MONTH_END_PLAN_UNRESOLVED", person.id, assignmentEvent?.id ?? null);
      }
    }
    if (details.success && details.data.commissionRole === "COMMISSION_EARNING" && !selected)
      block("COMMISSION_STAFF_PLAN_UNAVAILABLE", person.id, assignmentEvent?.id ?? null);
    return [
      {
        staff: { id: person.id, name: person.name, disabled: person.disabled },
        settings: details.success ? details.data : null,
        profile: profile.success ? profile.data : null,
        profileRevision: profileEvent?.revision ?? null,
        assignment: selected?.assignment ?? null,
        version: selected?.version ?? null,
        staffEvent: evidence(staffEvent),
        profileEvent: evidence(profileEvent),
      },
    ];
  });
  return structuredClone({
    status: blockers.length ? ("UNAVAILABLE" as const) : ("CONFIGURATION_READY" as const),
    earningsActive: false as const,
    periodKey,
    timeZone: raw.timeZone,
    startsAt: from.toISOString(),
    endsAt: to.toISOString(),
    blockers,
    // No partial usable configuration when even one required staff member is unresolved.
    configuration: blockers.length
      ? null
      : {
          settings: settings.success ? settings.data : null,
          settingsEvent: evidence(settingsEvent),
          assignmentEvent: evidence(assignmentEvent),
          staff: rows,
        },
  });
}
