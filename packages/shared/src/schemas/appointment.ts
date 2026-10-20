/**
 * Appointment contracts — handoff screens 03 and 06, `GET /api/appointments`.
 *
 * The booking model is `Appointment` exactly as Phase 2 left it: a time window
 * (`startsAt`/`endsAt`), a status, and optional links to a customer, a member of
 * staff and a service. Three columns are copied rather than derived —
 * `durationMinutes` is snapshotted from the service at booking time so a later
 * catalogue edit does not silently move an existing appointment (the schema's
 * own comment says so), while the names ride along denormalised so a receipt or
 * a day list renders without three joins.
 *
 * **The client never sends a duration or an end time.** The MVP's rule
 * (`docs/mvp.md` → M2) is that duration comes from the service rather than from
 * free text, so `createAppointmentSchema` takes a start and a `serviceId` and
 * the server computes the rest. A browser that could post its own `endsAt`
 * would put a two-hour booking on a one-hour service and the clash detection
 * that full-phase booking adds later would be judging a fiction.
 */
import { z } from "zod";

import { paginationQuerySchema } from "./common.js";

/** Mirrors the `AppointmentStatus` database enum, in the booking's own order. */
export const APPOINTMENT_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;

export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);

export type AppointmentStatusValue = z.infer<typeof appointmentStatusSchema>;

/** ISO 8601 instant — appointments are timestamps, not dates. */
export const isoInstantSchema = z.iso.datetime({ offset: true });

/**
 * `?from=&to=&status=&search=&page=&pageSize=`
 *
 * `from`/`to` are ISO 8601 **instants** — the day's own edges as the browser's
 * clock draws them — rather than bare dates. A `YYYY-MM-DD` pair would have to
 * be re-interpreted in some timezone on the server, and the salon's timezone is
 * not a column the schema has; sending the actual edges means the list the
 * screen shows and the window the server counts are the same instants. Both are
 * optional: no range means the whole book, which the day view never asks for
 * but an "all upcoming" read can.
 */
export const appointmentListQuerySchema = paginationQuerySchema.extend({
  from: isoInstantSchema.optional(),
  to: isoInstantSchema.optional(),
  /** Calendar occupancy reads include bookings which began before the window. */
  overlap: z.enum(["true", "false"]).optional(),
  status: appointmentStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
});

export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;

/** Who the booking is for. Flat, like every other row contract in this package. */
const appointmentPeople = {
  customerId: z.string().nullable(),
  /** `null` is a walk-in with no record — the same rule the till's chip keeps. */
  customerName: z.string().nullable(),
  /**
   * The **primary** performer — the one on the first service line. A
   * multi-service booking may have a different performer per line; read
   * `services` when the distinction matters.
   */
  staffId: z.string().nullable(),
  staffName: z.string().nullable(),
  /** The **primary** service — the first of `services`. */
  serviceId: z.string().nullable(),
  serviceName: z.string().nullable(),
  /** The service's branch at read time, so the day view can tint without a join. */
  serviceDepartmentId: z.string().nullable(),
};

/**
 * One booked service, in the order it is performed.
 *
 * A single-service booking has exactly one line, so a caller that does not care
 * about multi-service can keep reading the flat `serviceName`/`staffName` above
 * and be right. `startsAt`/`endsAt` are the line's own window: lines are a chain
 * from the booking's start, each beginning where the previous one ended.
 */
export const appointmentServiceLineSchema = z.object({
  serviceId: z.string(),
  serviceName: z.string().nullable(),
  serviceDepartmentId: z.string().nullable(),
  /** Null = nobody assigned to this line yet. */
  staffId: z.string().nullable(),
  staffName: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  durationMinutes: z.number().int(),
});

export type AppointmentServiceLine = z.infer<typeof appointmentServiceLineSchema>;

/**
 * The most services one booking may hold. A salon sells two or three together
 * (cut + colour + blow-dry); ten is a guard against a client loop, not a
 * business limit anyone is expected to reach.
 */
export const MAX_APPOINTMENT_SERVICES = 10;

/** A row in the day list. */
export const appointmentSummarySchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: appointmentStatusSchema,
  durationMinutes: z.number().int().nullable(),
  comment: z.string().nullable(),
  ...appointmentPeople,
  /** The booking's services, in order. Always at least one. */
  services: z.array(appointmentServiceLineSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AppointmentSummary = z.infer<typeof appointmentSummarySchema>;

/**
 * A single booking. The editor needs no columns the list does not have, so this
 * is the summary plus the two columns only a completed booking carries.
 */
export const appointmentDetailSchema = appointmentSummarySchema.extend({
  finishedAt: z.string().nullable(),
  customerConfirmedAt: z.string().nullable().optional(),
});

export type AppointmentDetail = z.infer<typeof appointmentDetailSchema>;

/**
 * One service chosen while booking.
 *
 * `staffId` overrides the booking-level performer for this line only — a cut by
 * one stylist and a manicure by another is the case multi-service exists for.
 * Absent or `null` means "whoever the booking names", and if the booking names
 * nobody the line is simply unassigned.
 */
export const appointmentServiceLineInputSchema = z.object({
  serviceId: z.string().min(1).max(64),
  staffId: z.string().min(1).max(64).nullable().optional(),
});

export type AppointmentServiceLineInput = z.infer<typeof appointmentServiceLineInputSchema>;

/**
 * Creating a booking.
 *
 * A booking names its services one of two ways, never both:
 *
 * - `serviceId` — one service, the shape every screen and test used before
 *   multi-service existed; or
 * - `services` — an ordered chain of one to `MAX_APPOINTMENT_SERVICES`. Line 0
 *   starts at `startsAt`, each next line starts where the previous ended, and the
 *   booking's `endsAt` is the end of the last one.
 *
 * Either way the server derives every end time and duration, and refuses a
 * performer outside the department of the service **on that line** (ADR 0013).
 *
 * There is deliberately no `tenantId` field — the tenant comes from the
 * verified JWT (`AGENTS.md` rule 1).
 */
export const createAppointmentSchema = z
  .object({
    /** Absent = a walk-in with no customer row, exactly as the till draws it. */
    customerId: z.string().min(1).max(64).optional(),
    /**
     * The performer for the booking. With `services` it is the default for every
     * line that does not name its own; with `serviceId` it is the booking's
     * performer, as before. Absent = unassigned.
     */
    staffId: z.string().min(1).max(64).optional(),
    serviceId: z.string().min(1).max(64).optional(),
    services: z
      .array(appointmentServiceLineInputSchema)
      .min(1)
      .max(MAX_APPOINTMENT_SERVICES)
      .optional(),
    startsAt: isoInstantSchema,
    status: appointmentStatusSchema.optional(),
    comment: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.serviceId !== undefined && value.services !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["services"],
        message: "Send either serviceId or services, not both",
      });
    }
    if (value.serviceId === undefined && value.services === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["services"],
        message: "A booking needs at least one service",
      });
    }
  });

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/**
 * Updating a booking.
 *
 * Every field optional, and an absent field is left unchanged rather than
 * nulled — the same PATCH rule the customer and staff editors keep, so a form
 * that omits a control cannot clear it. `status: COMPLETED` is how the day view
 * finishes a booking; the server sets `finishedAt` alongside it.
 *
 * `services` **replaces** the whole chain, like every other PATCH field replaces
 * its value; `serviceId` is the single-service form of the same move and keeps
 * the performer the booking already had. Sending both is refused.
 */
export const updateAppointmentSchema = z
  .object({
    customerId: z.string().min(1).max(64).nullable().optional(),
    staffId: z.string().min(1).max(64).nullable().optional(),
    serviceId: z.string().min(1).max(64).optional(),
    services: z
      .array(appointmentServiceLineInputSchema)
      .min(1)
      .max(MAX_APPOINTMENT_SERVICES)
      .optional(),
    startsAt: isoInstantSchema.optional(),
    status: appointmentStatusSchema.optional(),
    comment: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.serviceId !== undefined && value.services !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["services"],
        message: "Send either serviceId or services, not both",
      });
    }
  });

export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
