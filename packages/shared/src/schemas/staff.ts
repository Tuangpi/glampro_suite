/**
 * Staff contracts — handoff screen 09, `GET /api/staff`.
 *
 * **A staff member is a `User` row, not a second table.** Legacy proved this
 * (Q4 in [`legacy/LEGACY-MAP.md`](../../legacy/LEGACY-MAP.md) §6):
 * `EmployeeController::create()` created a `User`, and `employee_leaves.
 * employee_id` was a foreign key onto `users.id`. Staff is therefore a role plus
 * a profile on the same row, and this screen reads `User` directly.
 *
 * **Every staff member is created with an email and a password.** Early versions
 * allowed a "POS PIN only" row with a null `email`, which turned out to be an
 * account nobody could ever sign in to: `auth.service` refuses a web session
 * without an address and there is no POS terminal app holding one. The `posPin` is
 * not a login at all — it is the six-digit credential the till asks for, to
 * attribute a sale to this person on a shared terminal and, for a manager, to
 * approve an unpaid package-session override. So it stays optional and is never a
 * substitute for `email`.
 *
 * The API never accepts a tenant id; the Prisma extension scopes creation.
 */
import { z } from "zod";
import {
  payrollAssignmentWriteSchema,
  payrollStaffSettingsSchema,
} from "../commission-payroll/settings.js";

import { adminPasswordSchema, globalRoleSchema } from "./auth.js";
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

const commissionRateSchema = z.coerce.number().min(0).max(100).multipleOf(0.01);

export type StaffListQuery = z.infer<typeof staffListQuerySchema>;

/** A row in the screen-09 list. Never carries `passwordHash` or token material. */
export const staffSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  globalRole: globalRoleSchema,
  phone: z.string().nullable(),
  position: z.string().nullable(),
  commissionRate: z.string().optional(),
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
export const createStaffSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    email: emailSchema,
    password: z.string().min(PASSWORD_MIN_LENGTH, "Password is too short").max(200),
    /** The till credential. Attribution on a shared terminal, and approval for a manager. */
    posPin: z
      .string()
      .regex(/^\d{6}$/, "Use a six-digit PIN.")
      .optional(),
    globalRole: globalRoleSchema.optional(),
    phone: z.string().trim().max(64).optional(),
    /** Legacy `users.position` — the free-text job title shown in booking. */
    position: z.string().trim().max(120).optional(),
    commissionRate: commissionRateSchema.optional(),
    /** Calendar colour used to tint that person's appointments. */
    color: z.string().trim().max(32).optional(),
    avatar: z.string().trim().max(500).optional(),
    startDate: z.iso.date().optional(),
    payrollClassification: payrollStaffSettingsSchema
      .pick({ commissionRole: true, reason: true })
      .extend({ commissionRole: z.enum(["COMMISSION_EARNING", "NON_COMMISSION"]) })
      .optional(),
    payrollAssignment: payrollAssignmentWriteSchema
      .omit({ staffIds: true })
      .extend({
        planId: z.string().trim().min(1).max(128),
      })
      .optional(),
    endDate: z.iso.date().optional(),
    departmentIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .superRefine((staff, context) => {
    if (!staff.payrollClassification)
      context.addIssue({
        code: "custom",
        path: ["payrollClassification"],
        message: "An explicit reasoned payroll classification is required for staff creation.",
      });
    if (!staff.startDate)
      context.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "A join date is required with a payroll classification.",
      });
    if (
      staff.payrollClassification?.commissionRole === "COMMISSION_EARNING" &&
      !staff.payrollAssignment
    )
      context.addIssue({
        code: "custom",
        path: ["payrollAssignment"],
        message: "Commission-earning staff require an initial payroll plan.",
      });
    if (staff.payrollAssignment && !staff.startDate)
      context.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "A join date is required with a payroll plan.",
      });
    if (staff.globalRole === "SUPER_ADMIN") {
      const result = adminPasswordSchema.safeParse(staff.password);
      if (!result.success)
        context.addIssue({
          code: "custom",
          path: ["password"],
          message: result.error.issues[0].message,
        });
    }
  });

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

/**
 * Setting another person's password — the recovery path for a forgotten login.
 *
 * Two flows own a credential, and this is the second one. The first is the person's
 * own `POST /api/auth/change-password`, where they prove they know the current
 * password. This is the colleague case: the password is gone, so someone with
 * `SUPER_ADMIN` or `MANAGER` has to hand them a working login again.
 *
 * **Not a field on `updateStaffSchema`.** A profile PATCH has no session semantics,
 * so a password there would change the secret without ending the sessions that used
 * the old one — the back door [ADR 0007](../../../../PROJECT.md#adr-0007) warns
 * about. `POST /api/staff/:id/password` bumps `tokenVersion` and revokes the
 * target's refresh tokens in the same transaction instead.
 *
 * The floor is `PASSWORD_MIN_LENGTH`, matching creation rather than
 * `adminPasswordSchema`, because the stricter owner policy depends on the
 * **target's** role — something a request body cannot declare. The service applies
 * `adminPasswordSchema` when the target is an owner.
 */
export const resetStaffPasswordSchema = z.object({
  password: z.string().min(PASSWORD_MIN_LENGTH, "Password is too short").max(200),
});

export type ResetStaffPasswordInput = z.infer<typeof resetStaffPasswordSchema>;

/**
 * Updating a staff member's profile.
 *
 * **`password` is absent by design.** Two flows own a credential: the person's own
 * `POST /api/auth/change-password`, and `POST /api/staff/:id/password` for a
 * forgotten one (`resetStaffPasswordSchema`). Both bump `tokenVersion` and end every
 * session ([ADR 0007](../../../../PROJECT.md#adr-0007)). A password field on a
 * general profile-update endpoint would let a profile PATCH change someone's
 * password without ending their sessions — a back door around the flows that do it
 * correctly.
 *
 * `disabled` is a first-class field, not a delete: a disabled user keeps their
 * appointments and their commission history.
 */
export const updateStaffSchema = z
  .object({
    posPin: z
      .string()
      .regex(/^\d{6}$/, "Use a six-digit PIN.")
      .nullable()
      .optional(),
    name: z.string().trim().min(1, "Name is required").max(200).optional(),
    globalRole: globalRoleSchema.optional(),
    phone: z.string().trim().max(64).nullable().optional(),
    position: z.string().trim().max(120).nullable().optional(),
    commissionRate: commissionRateSchema.optional(),
    color: z.string().trim().max(32).nullable().optional(),
    avatar: z.string().trim().max(500).nullable().optional(),
    startDate: z.iso.date().nullable().optional(),
    expectedStartDate: z.iso.date().nullable().optional(),
    endDate: z.iso.date().nullable().optional(),
    disabled: z.boolean().optional(),
    departmentIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .superRefine((input, context) => {
    if (input.startDate !== undefined && input.expectedStartDate === undefined)
      context.addIssue({
        code: "custom",
        path: ["expectedStartDate"],
        message: "Reload the staff record before changing the start date.",
      });
  });

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
