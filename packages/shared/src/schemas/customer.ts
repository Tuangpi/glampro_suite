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

import { REDEMPTION_PAYMENT_METHODS } from "../constants.js";
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
export const customerEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => (value === "" ? null : value))
  .pipe(z.email().max(255).nullable());

export const createCustomerSchema = z.object({
  familyId: z.string().min(1).max(64).nullable().optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  code: z.string().trim().max(64).optional(),
  email: customerEmailSchema.optional(),
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
  familyId: z.string().min(1).max(64).nullable().optional(),
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  code: z.string().trim().max(64).nullable().optional(),
  email: customerEmailSchema.nullable().optional(),
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

/**
 * One thing a customer can still spend — `GET /api/customers/:id/holdings`.
 *
 * Two ledgers answer one question. `CustomerPackageHolding` counts sessions and
 * `CustomerValuePackageHolding` counts money, so they are merged into one list here:
 * the till draws one picker, and the cashier does not have to know which table a
 * customer's credit lives in.
 *
 * `kind` is the tender that spends the row (`PACKAGE` or `PREPAID_CREDIT`), so the
 * client groups the list without re-deriving it from the two nullable figures.
 * `amountRemaining` is money, so it is a string like every other `Decimal` on the
 * wire; `quantityRemaining` is a count and stays a number.
 *
 * `serviceIds` says which services a **package** may be spent on, and is empty for
 * credit — prepaid credit is fungible and pays for anything in the cart.
 */
export const customerHoldingSchema = z.object({
  id: z.string(),
  kind: z.enum(REDEMPTION_PAYMENT_METHODS),
  name: z.string(),
  serviceIds: z.array(z.string()),
  quantityRemaining: z.number().int().min(0),
  amountRemaining: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

export type CustomerHolding = z.infer<typeof customerHoldingSchema>;

export const customerHoldingsSchema = z.object({
  holdings: z.array(customerHoldingSchema),
});

export type CustomerHoldings = z.infer<typeof customerHoldingsSchema>;

export const customerVisitSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.string(),
  service: z.string().nullable(),
  staff: z.string().nullable(),
});
export type CustomerVisit = z.infer<typeof customerVisitSchema>;
export const customerPurchaseSchema = z.object({
  id: z.string(),
  soldAt: z.string(),
  status: z.string(),
  receiptNumber: z.number().nullable(),
  total: z.string(),
});
export type CustomerPurchase = z.infer<typeof customerPurchaseSchema>;
export const customerPhotoSchema = z.object({
  id: z.string(),
  caption: z.string(),
  createdAt: z.string(),
  createdById: z.string(),
});
export type CustomerPhoto = z.infer<typeof customerPhotoSchema>;
export const customerPhotoCaptionSchema = z.object({
  caption: z.string().trim().max(500).default(""),
});

/**
 * Treatment record contracts — aesthetics module.
 *
 * Mirrors the Prisma `TreatmentRecord` model field for field.
 */

/** Status enum exposed to the client — matches Prisma `TreatmentStatus`. */
export const TREATMENT_STATUS = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

export const treatmentStatusSchema = z.enum(TREATMENT_STATUS);

export type TreatmentStatusValue = z.infer<typeof treatmentStatusSchema>;

/** Photo type enum — matches Prisma `TreatmentPhotoType`. */
export const TREATMENT_PHOTO_TYPE = ["BEFORE", "AFTER"] as const;

export const treatmentPhotoTypeSchema = z.enum(TREATMENT_PHOTO_TYPE);

export type TreatmentPhotoTypeValue = z.infer<typeof treatmentPhotoTypeSchema>;

/** A treatment record row. */
export const treatmentRecordSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  appointmentId: z.string().nullable(),
  staffId: z.string().nullable(),
  serviceId: z.string().nullable(),
  treatmentType: z.string().trim().min(1).max(100),
  status: treatmentStatusSchema,
  notes: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  quantityConsumed: z.number().int().min(0),
  packageRedemptionId: z.string().nullable().optional(),
  packageHoldingId: z.string().nullable().optional(),
  /** POS reversal is disclosed without changing the clinical record or balance. */
  packageRedemptionRevertedAt: z.string().nullable().optional(),
  photos: z.array(z.lazy(() => treatmentPhotoSchema)).optional(),
  consentEvents: z.array(z.lazy(() => treatmentConsentEventSchema)).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TreatmentRecord = z.infer<typeof treatmentRecordSchema>;

export const treatmentRedemptionQuerySchema = paginationQuerySchema.extend({
  customerId: z.string().min(1).max(64),
  serviceId: z.string().min(1).max(64).optional(),
});
export type TreatmentRedemptionQuery = z.infer<typeof treatmentRedemptionQuerySchema>;

/** Read-only POS evidence; each service is covered by both the package and sale. */
export const treatmentRedemptionOptionSchema = z.object({
  id: z.string(),
  receiptNumber: z.number().int().nullable(),
  usedAt: z.iso.datetime(),
  packageName: z.string(),
  quantity: z.number().int().positive(),
  services: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
});
export type TreatmentRedemptionOption = z.infer<typeof treatmentRedemptionOptionSchema>;

/** Creating a treatment record. */
export const createTreatmentRecordSchema = z.object({
  packageRedemptionId: z.string().min(1).max(64).nullable().optional(),
  customerId: z.string().min(1),
  appointmentId: z.string().optional(),
  staffId: z.string().optional(),
  serviceId: z.string().optional(),
  treatmentType: z.string().trim().min(1, "Treatment type is required").max(100),
  status: treatmentStatusSchema.default("SCHEDULED"),
  notes: z.string().trim().max(2000).nullable().optional(),
  startedAt: z.union([z.iso.date(), z.iso.datetime()]).nullable().optional(),
  endedAt: z.union([z.iso.date(), z.iso.datetime()]).nullable().optional(),
  quantityConsumed: z.number().int().min(0).default(0),
});

export type CreateTreatmentRecordInput = z.infer<typeof createTreatmentRecordSchema>;

/** Updating a treatment record. */
export const updateTreatmentRecordSchema = z.object({
  packageRedemptionId: z.string().min(1).max(64).nullable().optional(),
  treatmentType: z.string().trim().min(1).max(100).optional(),
  status: treatmentStatusSchema.optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  startedAt: z.union([z.iso.date(), z.iso.datetime()]).nullable().optional(),
  endedAt: z.union([z.iso.date(), z.iso.datetime()]).nullable().optional(),
  quantityConsumed: z.number().int().min(0).optional(),
});

export type UpdateTreatmentRecordInput = z.infer<typeof updateTreatmentRecordSchema>;

/** A treatment photo row. */
export const treatmentPhotoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  treatmentRecordId: z.string(),
  customerPhotoId: z.string(),
  photoType: treatmentPhotoTypeSchema,
  caption: z.string().nullable(),
  createdAt: z.string(),
});

export type TreatmentPhoto = z.infer<typeof treatmentPhotoSchema>;

/** Linking an existing customer photo as a before/after treatment photo. */
export const createTreatmentPhotoSchema = z.object({
  treatmentRecordId: z.string().min(1),
  customerPhotoId: z.string().min(1),
  photoType: treatmentPhotoTypeSchema,
  caption: z.string().trim().max(500).nullable().optional(),
});

export type CreateTreatmentPhotoInput = z.infer<typeof createTreatmentPhotoSchema>;

/** A treatment consent form row. */
export const treatmentConsentFormSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  treatmentType: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1),
  version: z.number().int().min(1),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TreatmentConsentForm = z.infer<typeof treatmentConsentFormSchema>;

export const treatmentConsentTypeParamsSchema = z.object({
  treatmentType: z.string().trim().min(1).max(100),
});

export const treatmentConsentFormListQuerySchema = z.object({
  treatmentType: z.string().trim().min(1).max(100).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});
export type TreatmentConsentFormListQuery = z.infer<typeof treatmentConsentFormListQuerySchema>;

/** Creating a treatment consent form. */
export const createTreatmentConsentFormSchema = z.object({
  treatmentType: z.string().trim().min(1).max(100, "Treatment type is required"),
  title: z.string().trim().min(1, "Title is required").max(200),
  content: z.string().trim().min(1, "Content is required"),
  version: z.number().int().min(1).default(1),
  isActive: z.boolean().default(true),
});

export type CreateTreatmentConsentFormInput = z.infer<typeof createTreatmentConsentFormSchema>;

/** A treatment consent event row. */
export const treatmentConsentEventSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  treatmentRecordId: z.string(),
  treatmentConsentFormId: z.string(),
  customerId: z.string(),
  consented: z.boolean(),
  consentedAt: z.string(),
  consentedById: z.string(),
  signatureData: z.string().nullable(),
  createdAt: z.string(),
  treatmentConsentForm: treatmentConsentFormSchema.optional(),
});

export type TreatmentConsentEvent = z.infer<typeof treatmentConsentEventSchema>;

/** Recording a customer's consent to a treatment consent form. */
export const createTreatmentConsentEventSchema = z.object({
  treatmentRecordId: z.string().min(1),
  treatmentConsentFormId: z.string().min(1),
  customerId: z.string().min(1),
  consented: z.boolean(),
  // The witness comes from authentication. Signature capture is not implemented.
  signatureData: z.null().optional(),
});

export type CreateTreatmentConsentEventInput = z.infer<typeof createTreatmentConsentEventSchema>;

/** Treatment record list filters. */
export const treatmentRecordListQuerySchema = paginationQuerySchema.extend({
  customerId: z.string().optional(),
  treatmentType: z.string().optional(),
  status: treatmentStatusSchema.optional(),
});

export type TreatmentRecordListQuery = z.infer<typeof treatmentRecordListQuerySchema>;
