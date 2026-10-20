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
  staffId: z.string().nullable(),
  staffName: z.string().nullable(),
  serviceId: z.string().nullable(),
  serviceName: z.string().nullable(),
  /** The service's branch at read time, so the day view can tint without a join. */
  serviceDepartmentId: z.string().nullable(),
};

/** A row in the day list. */
export const appointmentSummarySchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: appointmentStatusSchema,
  durationMinutes: z.number().int().nullable(),
  comment: z.string().nullable(),
  ...appointmentPeople,
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
 * Creating a booking.
 *
 * `serviceId` is **required**: duration and the eligibility of a performer both
 * come from the service, so a booking with no service would have to invent them.
 * The server derives `endsAt` and `durationMinutes`, and refuses a `staffId`
 * outside the service's department (ADR 0013).
 *
 * There is deliberately no `tenantId` field — the tenant comes from the
 * verified JWT (`AGENTS.md` rule 1).
 */
export const createAppointmentSchema = z.object({
  /** Absent = a walk-in with no customer row, exactly as the till draws it. */
  customerId: z.string().min(1).max(64).optional(),
  /** Absent = unassigned. A service whose department has nobody stays bookable. */
  staffId: z.string().min(1).max(64).optional(),
  serviceId: z.string().min(1).max(64),
  startsAt: isoInstantSchema,
  status: appointmentStatusSchema.optional(),
  comment: z.string().trim().max(2000).optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/**
 * Updating a booking.
 *
 * Every field optional, and an absent field is left unchanged rather than
 * nulled — the same PATCH rule the customer and staff editors keep, so a form
 * that omits a control cannot clear it. `status: COMPLETED` is how the day view
 * finishes a booking; the server sets `finishedAt` alongside it.
 */
export const updateAppointmentSchema = z.object({
  customerId: z.string().min(1).max(64).nullable().optional(),
  staffId: z.string().min(1).max(64).nullable().optional(),
  serviceId: z.string().min(1).max(64).optional(),
  startsAt: isoInstantSchema.optional(),
  status: appointmentStatusSchema.optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
});

export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
