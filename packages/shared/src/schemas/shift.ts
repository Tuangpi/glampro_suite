/**
 * Staff shift contracts — the rota behind handoff screens 06 and 09,
 * `GET /api/shifts`.
 *
 * **A shift is a wall-clock statement, not an instant.** "Today 9:00 AM – 6:00
 * PM" is true every Tuesday the salon is open, and it means a different UTC
 * instant in every month and in every timezone the salon has ever operated in.
 * So a shift row carries **minutes since local midnight** (`startsAtMinute`)
 * rather than a `DateTime`, and a day of the week rather than a date. Legacy had
 * no rota table at all — `employee_leaves` was the whole absence surface — so
 * there is no imported shape to be faithful to, which makes this a deliberate
 * model rather than a transcription.
 *
 * That choice has one consequence this file's rules exist to contain: a booking
 * is a UTC instant and a shift is a wall clock, and the two only meet through a
 * **validated IANA timezone the browser sends**, exactly as
 * `reportRangeQuerySchema` already does. `Date#getHours()` in the API would gate
 * a Bangkok salon by a Frankfurt server's clock, and the offset on the instant
 * the client sends is no help either: `toISOString()` is always `Z`, so every
 * wall clock would read as UTC. A named zone applied with `Intl` gets both the
 * weekday and the minutes-past-midnight right, DST included. See ADR 0019 §3.
 *
 * `dayOfWeek` is **0 = Sunday**, matching JavaScript's `Date#getDay()`, which is
 * the only thing that will ever read this column. The calendar grid is
 * Monday-first, but that is a presentation order the client applies; making the
 * stored value ISO-numbered so one view reads more naturally would make every
 * other reader off by one.
 */
import { z } from "zod";

import { paginationQuerySchema } from "./common.js";

/**
 * What a row of the track is.
 *
 * A break is a **negative** interval inside a work shift, stored as a row of the
 * same table rather than as an array on the shift, so that "does this booking
 * fit" is one rule over one set of intervals instead of two rules over two
 * shapes. A booking overlapping a `BREAK` is refused for exactly the reason a
 * booking falling outside a `WORK` is: the person is not available then.
 */
export const SHIFT_KINDS = ["WORK", "BREAK"] as const;

export const shiftKindSchema = z.enum(SHIFT_KINDS);

export type ShiftKindValue = z.infer<typeof shiftKindSchema>;

/**
 * Days of the week, 0 = Sunday, derived from `Date#getDay()` rather than typed
 * out again so the two cannot drift.
 */
export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

export const dayOfWeekSchema = z.coerce.number().int().min(0).max(6);

export type DayOfWeekValue = z.infer<typeof dayOfWeekSchema>;

/**
 * Minutes since local midnight.
 *
 * Not a time string and not an instant: minutes are what the calendar grid
 * already speaks (`calendar-geometry.ts` works in `minutesIntoDay` and
 * `PX_PER_MINUTE`), so containment is arithmetic rather than parsing. The upper
 * bound is 1440 rather than 1439 because 24:00 is how a shift ending at
 * midnight is honestly written.
 */
export const minuteOfDaySchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(24 * 60);

/**
 * `?page=&pageSize=&userId=&dayOfWeek=&kind=&on=`
 *
 * `on` is a **local calendar date** the browser sends, exactly as the dashboard
 * sends two instants rather than letting the server guess where the day falls:
 * the salon's day is the clock in front of the screen, and the schema has no
 * timezone column to ask. The service uses it to test each row's
 * `effectiveFrom`/`effectiveTo` window, which is the part a `where` clause
 * cannot express because "today" is not a stored value.
 */
export const shiftListQuerySchema = paginationQuerySchema.extend({
  /** One performer's rota. Omitted = the whole salon's. */
  userId: z.string().trim().min(1).max(64).optional(),
  /** One weekday. Omitted = the whole week. */
  dayOfWeek: dayOfWeekSchema.optional(),
  kind: shiftKindSchema.optional(),
  /** The local date the effective window is judged against. */
  on: z.iso.date().optional(),
});

export type ShiftListQuery = z.infer<typeof shiftListQuerySchema>;

/** A row in the rota. */
export const shiftSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  /** Denormalised so a rota renders without a join per row. */
  userName: z.string(),
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: z.number().int().min(0).max(6),
  startsAtMinute: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  endsAtMinute: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  kind: shiftKindSchema,
  /**
   * When this published rota starts applying. `null` = it has always applied.
   *
   * A window rather than a bare row is what lets a salon publish next month's
   * rota without overwriting this month's, and it is what a future dated-
   * override layer would hang off without rewriting existing rows.
   */
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ShiftSummary = z.infer<typeof shiftSummarySchema>;

export const shiftDetailSchema = shiftSummarySchema;

export type ShiftDetail = z.infer<typeof shiftDetailSchema>;

/**
 * A window of one day, in minutes — the plain object **before** refinement.
 *
 * Split out because Zod v4 refuses `.partial()`/`.extend()` on a schema that
 * already carries a `.refine()`, so every schema below extends this shape and
 * applies the "ends after it starts" rule as its **last** step.
 */
const shiftWindowShape = z.object({
  startsAtMinute: minuteOfDaySchema,
  endsAtMinute: minuteOfDaySchema,
});

/** The shared message/path so both schemas below word the refusal identically. */
const endsAfterStarts: { message: string; path: PropertyKey[] } = {
  message: "A shift has to end after it starts.",
  path: ["endsAtMinute"],
};

/** ISO dates sort chronologically; either missing bound means open-ended. */
export function shiftDatesOrdered(shift: {
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}): boolean {
  return !shift.effectiveFrom || !shift.effectiveTo || shift.effectiveFrom <= shift.effectiveTo;
}

const datesOrdered = {
  message: "A shift's effective end date cannot precede its start date.",
  path: ["effectiveTo"],
};

/**
 * A window of one day, in minutes. Shared by the schema and the service so the
 * "ends after it starts" rule is written once.
 */
export const shiftWindowSchema = shiftWindowShape.refine(
  (window) => window.endsAtMinute > window.startsAtMinute,
  endsAfterStarts,
);

/**
 * Publishing a shift.
 *
 * `userId` is required — a rota row with nobody on it is not a shift. There is
 * deliberately no `tenantId`: the tenant comes from the verified JWT
 * (AGENTS.md rule 1).
 *
 * A shift may not cross midnight. Refusing rather than splitting it is the
 * deliberate choice: the calendar's gutter is 08:00–20:00, so an overnight row
 * would be accepted by the API and then drawn as nothing on both of its days —
 * the silent hole ADR 0018 spent its §5 refusing to accept. A salon that runs
 * nights gets a clear refusal instead.
 */
export const createShiftSchema = shiftWindowShape
  .extend({
    userId: z.string().trim().min(1).max(64),
    dayOfWeek: dayOfWeekSchema,
    kind: shiftKindSchema.default("WORK"),
    effectiveFrom: z.iso.date().optional(),
    effectiveTo: z.iso.date().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((shift) => shift.endsAtMinute > shift.startsAtMinute, endsAfterStarts)
  .refine(shiftDatesOrdered, datesOrdered);

export type CreateShiftInput = z.infer<typeof createShiftSchema>;

/**
 * Updating a shift.
 *
 * Every field optional and absent means unchanged, the same PATCH rule the
 * customer, staff and appointment editors keep, so a form that omits a control
 * cannot clear it. The window is re-validated as a whole rather than per field,
 * because "starts at 5" and "ends at 4" are each legal alone.
 */
export const updateShiftSchema = shiftWindowShape
  .partial()
  .extend({
    userId: z.string().trim().min(1).max(64).optional(),
    dayOfWeek: dayOfWeekSchema.optional(),
    kind: shiftKindSchema.optional(),
    effectiveFrom: z.iso.date().nullable().optional(),
    effectiveTo: z.iso.date().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    // Only judged when **both** ends were sent: a half-window is legal on its
    // own, and the service re-checks the merged view against the row anyway.
    (shift) =>
      shift.startsAtMinute === undefined ||
      shift.endsAtMinute === undefined ||
      shift.endsAtMinute > shift.startsAtMinute,
    endsAfterStarts,
  )
  .refine(shiftDatesOrdered, datesOrdered);

export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
