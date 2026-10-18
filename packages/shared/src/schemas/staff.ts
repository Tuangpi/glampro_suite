/**
 * Staff contracts — handoff screen 09, `GET /api/staff`.
 *
 * **A staff member is a `User` row, not a second table.** Legacy proved this
 * (Q4 in [`legacy/LEGACY-MAP.md`](../../legacy/LEGACY-MAP.md) §6):
 * `EmployeeController::create()` created a `User`, and `employee_leaves.
 * employee_id` was a foreign key onto `users.id`. Staff is therefore a role plus
 * a profile on the same row, and this screen reads `User` directly.
 *
 * That has a consequence the legacy system never had to face: **creating staff
 * creates a login.** `email` and `password` are required here for the same reason
 * they are on the sign-up form, and the API never accepts a tenant id — the new
 * user is created inside the caller's tenant by the Prisma extension.
 */
import { z } from "zod";

import { globalRoleSchema } from "./auth.js";
import { PASSWORD_MIN_LENGTH } from "../constants.js";
import { emailSchema, paginationQuerySchema } from "./common.js";

/**
 * `?page=&pageSize=&search=&role=&status=`
 *
 * `status` takes `disabled` and `all` rather than a boolean, because the screen's
 * own toolbar has "All staff" / "Active only" / "Disabled" and a bare
 * `?disabled=true` cannot express "all".
 */
export const staffListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  role: globalRoleSchema.optional(),
  status: z.enum(["all", "active", "disabled"]).default("all"),
});

export type StaffListQuery = z.infer<typeof staffListQuerySchema>;

/** A row in the screen-09 list. Never carries `passwordHash` or token material. */
export const staffSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  globalRole: globalRoleSchema,
  phone: z.string().nullable(),
  position: z.string().nullable(),
  color: z.string().nullable(),
  avatar: z.string().nullable(),
  /** Legacy `users.start_date` / `end_date`. */
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  /** A user with `disabled` set cannot sign in. This is not a soft delete. */
  disabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
  departments: z.array(z.object({ id: z.string(), name: z.string() })),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StaffSummary = z.infer<typeof staffSummarySchema>;

export const staffDetailSchema = staffSummarySchema;

export type StaffDetail = z.infer<typeof staffDetailSchema>;

/**
 * Creating a staff member — a login plus a profile.
 *
 * `email` is globally unique because `users.email` carries `@unique` in the
 * schema. That is a **user** constraint, not a tenant one: a person has one
 * login however many salons they work at, which is why it is not per-tenant like
 * the customer email ([ADR 0003](../../../../PROJECT.md#adr-0003)).
 *
 * `globalRole` defaults to `STAFF`, the least privileged role, so a client that
 * forgets the field cannot accidentally mint an owner.
 */
export const createStaffSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: emailSchema,
  password: z.string().min(PASSWORD_MIN_LENGTH, "Password is too short").max(200),
  globalRole: globalRoleSchema.optional(),
  phone: z.string().trim().max(64).optional(),
  /** Legacy `users.position` — the free-text job title shown in booking. */
  position: z.string().trim().max(120).optional(),
  /** Calendar colour used to tint that person's appointments. */
  color: z.string().trim().max(32).optional(),
  avatar: z.string().trim().max(500).optional(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  departmentIds: z.array(z.string().min(1)).max(50).optional(),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

/**
 * Updating a staff member's profile.
 *
 * **`password` is absent by design.** Changing a password goes through
 * `POST /api/auth/change-password`, which bumps `tokenVersion` and ends every
 * session ([ADR 0007](../../../../PROJECT.md#adr-0007)).
 * A password field on a general profile-update endpoint would let a manager
 * change someone's password without ending their sessions — a back door around
 * the one flow that does it correctly.
 *
 * `disabled` is a first-class field, not a delete: a disabled user keeps their
 * appointments and their commission history.
 */
export const updateStaffSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  globalRole: globalRoleSchema.optional(),
  phone: z.string().trim().max(64).nullable().optional(),
  position: z.string().trim().max(120).nullable().optional(),
  color: z.string().trim().max(32).nullable().optional(),
  avatar: z.string().trim().max(500).nullable().optional(),
  startDate: z.iso.date().nullable().optional(),
  endDate: z.iso.date().nullable().optional(),
  disabled: z.boolean().optional(),
  departmentIds: z.array(z.string().min(1)).max(50).optional(),
});

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
