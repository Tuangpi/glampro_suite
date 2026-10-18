/**
 * Customer contracts — handoff screen 07, `GET /api/customers`.
 *
 * The shapes here mirror the Prisma `Customer` model field for field. That is
 * deliberate: screen 07 is a list of customers and nothing more, and the model
 * was deliberately re-modelled from the legacy `customers` table rather than
 * copied from it.
 *
 * **Three columns on the handoff screen have no field to read.** `Last visit` and
 * `Total spend` are aggregates over `Sale` / `SaleLine`, which the POS phase
 * (Phase 5) owns, and `Tier` reads a `Membership` row that the schema does not
 * have at all. All three are therefore **absent** from `CustomerSummary` rather
 * than faked — `PROJECT.md#design-6` says the screen changes where
 * it disagrees with the real data model, and a placeholder zero would be a lie
 * the salon would read as "this customer has never spent anything".
 */
import { z } from "zod";

import { paginationQuerySchema } from "./common.js";

/** Legacy `gender` was a string on customers and an integer on users (Q5). */
export const GENDERS = ["MALE", "FEMALE", "OTHER", "UNDISCLOSED"] as const;

export const genderSchema = z.enum(GENDERS);

export type GenderValue = z.infer<typeof genderSchema>;

/**
 * `?page=&pageSize=&search=&memberId=`
 *
 * `search` is free text because the screen's own placeholder is
 * "Search name or phone…" — the API matches either field case-insensitively
 * rather than making the caller know which one the salon typed into.
 */
export const customerListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  /** Restrict to customers carrying this membership reference. */
  memberId: z.string().trim().max(64).optional(),
});

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

/** A row in the screen-07 list. */
export const customerSummarySchema = z.object({
  id: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  memberId: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  gender: genderSchema.nullable(),
  dateOfBirth: z.string().nullable(),
  address: z.string().nullable(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CustomerSummary = z.infer<typeof customerSummarySchema>;

/**
 * A single customer with the detail the drawer/editor needs.
 *
 * `departments` is included because the legacy customer form had a branch picker
 * and `CustomerDepartment` is how that is expressed — the list screen has no
 * column for it, but the editor does.
 */
export const customerDetailSchema = customerSummarySchema.extend({
  hairCardNumber: z.string().nullable(),
  maniCardNumber: z.string().nullable(),
  cardNumber: z.string().nullable(),
  departments: z.array(z.object({ id: z.string(), name: z.string() })),
});

export type CustomerDetail = z.infer<typeof customerDetailSchema>;

/**
 * Creating a customer.
 *
 * `name` is the only required field, which matches both the legacy form and the
 * screen's own "Add customer" button: a salon takes a walk-in by name alone and
 * fills the rest in later.
 *
 * **There is deliberately no `tenantId` field.** The tenant comes from the
 * verified JWT and is applied by the Prisma client extension — a schema that
 * accepted one would be an invitation to trust the request
 * (`AGENTS.md` rule 1, `docs/saas/TENANCY.md`).
 */
export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  code: z.string().trim().max(64).optional(),
  email: z.email().max(255).optional(),
  phone: z.string().trim().max(64).optional(),
  gender: genderSchema.optional(),
  /** `YYYY-MM-DD`. Legacy `dob` was a free-text string; the importer normalises it. */
  dateOfBirth: z.iso.date().optional(),
  address: z.string().trim().max(500).optional(),
  comment: z.string().trim().max(2000).optional(),
  memberId: z.string().trim().max(64).optional(),
  hairCardNumber: z.string().trim().max(64).optional(),
  maniCardNumber: z.string().trim().max(64).optional(),
  cardNumber: z.string().trim().max(64).optional(),
  departmentIds: z.array(z.string().min(1)).max(50).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/**
 * Updating a customer.
 *
 * Every field is optional, and an **absent** field is left unchanged rather than
 * nulled — the editor is a PATCH-shaped form, and a partial submit must not
 * clear a customer's address because the field was simply not touched. Clearing a
 * value is an explicit `null`.
 */
export const updateCustomerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  code: z.string().trim().max(64).nullable().optional(),
  email: z.email().max(255).nullable().optional(),
  phone: z.string().trim().max(64).nullable().optional(),
  gender: genderSchema.nullable().optional(),
  dateOfBirth: z.iso.date().nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
  memberId: z.string().trim().max(64).nullable().optional(),
  hairCardNumber: z.string().trim().max(64).nullable().optional(),
  maniCardNumber: z.string().trim().max(64).nullable().optional(),
  cardNumber: z.string().trim().max(64).nullable().optional(),
  departmentIds: z.array(z.string().min(1)).max(50).optional(),
});

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
