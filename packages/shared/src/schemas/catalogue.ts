/**
 * Catalogue contracts — handoff screen 08, `GET /api/products` and
 * `GET /api/services`.
 *
 * **Services live here, not on a screen of their own.** There is no `/services`
 * route and no Services entry on the rail: services are a tab inside this
 * catalogue and a step in the sale and appointment flows
 * ([ADR 0005](../../../../PROJECT.md#adr-0005)). So the
 * two share one file and one module code — to a salon and to the entitlement
 * check they are the same feature.
 *
 * Both models carry an identical price/points/status shape, which is why they
 * share the base fields below rather than each declaring its own object.
 */
import { z } from "zod";
import { payrollPackageSettingsSchema } from "../commission-payroll/package-settings.js";

import {
  barcodeInputSchema,
  durationMinutesSchema,
  moneySchema,
  paginationQuerySchema,
  pointsSchema,
  quantitySchema,
} from "./common.js";

/**
 * Shared active flag. Mirrors the `CatalogStatus` database enum, which exists
 * because the legacy `services` and `products` tables each carried their own
 * `status boolean` with the same meaning but a different default.
 */
export const CATALOG_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export const catalogStatusSchema = z.enum(CATALOG_STATUSES);

export type CatalogStatusValue = z.infer<typeof catalogStatusSchema>;

/**
 * `?page=&pageSize=&search=&status=&departmentId=&lowStock=`
 *
 * `lowStock=true` is what the rail's Products badge counts. It is a **server-side
 * filter, not a client-side sort** — the badge is a live count over the tenant's
 * whole catalogue, which a single paginated page cannot compute.
 */
export const catalogueListQuerySchema = paginationQuerySchema.extend({
  familyId: z.string().min(1).max(64).optional(),
  search: z.string().trim().max(200).optional(),
  status: catalogStatusSchema.optional(),
  departmentId: z.string().min(1).max(64).optional(),
  /** Products only. Returns rows whose quantity is at or below `threshold`. */
  lowStock: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .optional(),
  threshold: z.coerce.number().int().min(0).max(10_000).optional(),
});

export type CatalogueListQuery = z.infer<typeof catalogueListQuerySchema>;

/** A branch/section, for the department pickers on every catalogue form. */
export const departmentSchema = z.object({
  id: z.string(),
  name: z.string(),
});

/**
 * A product row for screen 08.
 *
 * Prices are **strings on the wire**, not numbers. The column is `Decimal(12,2)`
 * and PostgreSQL `numeric` has exact decimal semantics a JSON float cannot
 * represent; a salon counting money gets a string it formats, not a float that
 * has already lost a cent. Inputs are coerced by `moneySchema`.
 */
export const productSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: catalogStatusSchema,
  /** Serialised with `.toFixed(2)`. */
  memberPrice: z.string(),
  nonmemberPrice: z.string(),
  quantity: z.number().int(),
  points: z.number().int(),
  description: z.string().nullable(),
  /** Scannable barcode, normalised (trimmed, upper-cased) or null. */
  barcode: z.string().nullable(),
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
  /** True when `quantity` is at or below the tenant's low-stock threshold. */
  lowStock: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ProductSummary = z.infer<typeof productSummarySchema>;

export const productDetailSchema = productSummarySchema;

export type ProductDetail = z.infer<typeof productDetailSchema>;

/** Creating a product. `quantity` and `points` default to zero server-side. */
export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  memberPrice: moneySchema,
  nonmemberPrice: moneySchema,
  quantity: quantitySchema.optional(),
  points: pointsSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  departmentId: z.string().min(1).max(64).optional(),
  status: catalogStatusSchema.optional(),
  /** Optional barcode. Blank means "no barcode" and is stored as null. */
  barcode: barcodeInputSchema,
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * Updating a product. Absent means unchanged; `null` clears an optional field.
 * `quantity` is deliberately **not** nullable — stock is corrected by adjustment,
 * not by erasing it.
 */
export const updateProductSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  memberPrice: moneySchema.optional(),
  nonmemberPrice: moneySchema.optional(),
  quantity: quantitySchema.optional(),
  points: pointsSchema.optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  departmentId: z.string().min(1).max(64).nullable().optional(),
  status: catalogStatusSchema.optional(),
  /** Optional barcode. Blank or null clears the barcode. */
  barcode: barcodeInputSchema,
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type DepartmentSummary = z.infer<typeof departmentSchema>;
/**
 * A service row.
 *
 * No `quantity` and no `lowStock`: a service is not stock, and the handoff's own
 * screen 08 shows products and services as two tabs with different columns.
 */
export const serviceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: catalogStatusSchema,
  memberPrice: z.string(),
  nonmemberPrice: z.string(),
  points: z.number().int(),
  description: z.string().nullable(),
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  interval: z.number().int().min(1).max(365).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ServiceSummary = z.infer<typeof serviceSummarySchema>;

export const serviceDetailSchema = serviceSummarySchema;

export type ServiceDetail = z.infer<typeof serviceDetailSchema>;

/**
 * Creating a service.
 *
 * `durationMinutes` is optional here even though booking needs it: the legacy
 * table had no such column, so a migrated salon has services with no duration
 * until someone fills it in. The appointment flow is where a missing duration
 * becomes a blocking question — not this form.
 */
export const createServiceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  memberPrice: moneySchema,
  nonmemberPrice: moneySchema,
  points: pointsSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  departmentId: z.string().min(1).max(64).optional(),
  durationMinutes: durationMinutesSchema.optional(),
  interval: z.number().int().min(1).max(365).nullable().optional(),
  status: catalogStatusSchema.optional(),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  memberPrice: moneySchema.optional(),
  nonmemberPrice: moneySchema.optional(),
  points: pointsSchema.optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  departmentId: z.string().min(1).max(64).nullable().optional(),
  durationMinutes: durationMinutesSchema.nullable().optional(),
  interval: z.number().int().min(1).max(365).nullable().optional(),
  status: catalogStatusSchema.optional(),
});

export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

/**
 * Packages and gift cards — the last two tabs of handoff screen 08.
 *
 * Both are **add-ons**, not core features (`MODULE_CODES`: `packages`,
 * `giftCards`), so each has its own mount and its own module code even though the
 * handoff draws them as two more tabs of this one screen. A salon that has not
 * bought one is refused by `requireModule` with `MODULE_NOT_ENTITLED` rather than
 * shown an empty tab — "you have none" and "you do not have this" are different
 * statements and only one of them is true.
 *
 * Money is a **string on the wire** here for the same reason it is on a product:
 * the column is `Decimal(12,2)` and a JSON float has already lost the cent.
 */

/**
 * Sessions a package grants. Zero is a migrated state (legacy `no_of_time`
 * defaulted to it) and must survive a read; a *new* package that grants nothing is
 * a name with a price, so create asks for at least one.
 */
const sessionCountSchema = z.coerce.number().int().min(0).max(10_000);

/** Whole 24-hour periods from completed purchase. Null means no expiry. */
export const packageValidityDaysSchema = z.number().int().min(1).max(36_500).nullable();

export const updatePrepaidValiditySchema = z.object({ validityDays: packageValidityDaysSchema });
export type UpdatePrepaidValidityInput = z.infer<typeof updatePrepaidValiditySchema>;

/** A bundle of sessions. Legacy `packages`. */
export const packageSummarySchema = z.object({
  commissionSettings: payrollPackageSettingsSchema.nullable().optional(),
  redemptionMode: z.enum(["PER_UNIT", "SERVICE_SET"]).optional(),
  serviceSet: z
    .array(
      z.object({
        serviceId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(100),
      }),
    )
    .max(200)
    .optional(),
  id: z.string(),
  name: z.string(),
  status: catalogStatusSchema,
  /** Sessions the bundle contains. Legacy `no_of_time`. */
  sessionCount: z.number().int(),
  validityDays: packageValidityDaysSchema.optional(),
  memberPrice: z.string(),
  nonmemberPrice: z.string(),
  description: z.string().nullable(),
  /**
   * How many services the bundle may be spent on — the count, not the list,
   * because the table has one column for it and only the editor needs the ids.
   */
  serviceCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PackageSummary = z.infer<typeof packageSummarySchema>;

/** The same row plus the services it covers, which only the editor reads. */
export const packageDetailSchema = packageSummarySchema.extend({
  services: z.array(z.object({ id: z.string(), name: z.string() })),
});

export type PackageDetail = z.infer<typeof packageDetailSchema>;

export const createPackageSchema = z
  .object({
    commissionSettings: payrollPackageSettingsSchema.optional(),
    commissionReason: z.string().trim().min(3).max(500).optional(),
    redemptionMode: z.enum(["PER_UNIT", "SERVICE_SET"]).optional(),
    serviceSet: z
      .array(
        z.object({
          serviceId: z.string().min(1).max(64),
          quantity: z.number().int().min(1).max(100),
        }),
      )
      .max(200)
      .optional(),
    validityDays: packageValidityDaysSchema.optional(),
    familyId: z.string().min(1).max(64).nullable().optional(),
    name: z.string().trim().min(1, "Name is required").max(200),
    sessionCount: sessionCountSchema.min(1, "A package has to include at least one session"),
    memberPrice: moneySchema,
    nonmemberPrice: moneySchema,
    description: z.string().trim().max(2000).optional(),
    status: catalogStatusSchema.optional(),
    /**
     * The services this bundle covers. `PackageService` exists because legacy
     * `package_services` did, and an id from another salon is refused rather than
     * linked — see `assertServicesExist`.
     */
    serviceIds: z.array(z.string().min(1).max(64)).max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.commissionSettings && !value.commissionReason)
      ctx.addIssue({
        code: "custom",
        path: ["commissionReason"],
        message: "Enter a commission settings reason.",
      });
  });

export type CreatePackageInput = z.infer<typeof createPackageSchema>;

/**
 * Updating a package. `serviceIds` follows the same rule as every other field
 * here — **absent means unchanged** — with an empty array as the way to say
 * "covers nothing", because `[]` is a value an absent key is not.
 */
export const updatePackageSchema = z
  .object({
    commissionSettings: payrollPackageSettingsSchema.optional(),
    commissionReason: z.string().trim().min(3).max(500).optional(),
    expectedUpdatedAt: z.iso.datetime().optional(),
    redemptionMode: z.enum(["PER_UNIT", "SERVICE_SET"]).optional(),
    serviceSet: z
      .array(
        z.object({
          serviceId: z.string().min(1).max(64),
          quantity: z.number().int().min(1).max(100),
        }),
      )
      .max(200)
      .optional(),
    validityDays: packageValidityDaysSchema.optional(),
    familyId: z.string().min(1).max(64).nullable().optional(),
    name: z.string().trim().min(1, "Name is required").max(200).optional(),
    sessionCount: sessionCountSchema.optional(),
    memberPrice: moneySchema.optional(),
    nonmemberPrice: moneySchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    status: catalogStatusSchema.optional(),
    serviceIds: z.array(z.string().min(1).max(64)).max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.commissionSettings) {
      if (!value.commissionReason)
        ctx.addIssue({
          code: "custom",
          path: ["commissionReason"],
          message: "Enter a commission settings reason.",
        });
      if (!value.expectedUpdatedAt)
        ctx.addIssue({
          code: "custom",
          path: ["expectedUpdatedAt"],
          message: "Reload the package before changing commission settings.",
        });
    }
  });

export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;

/**
 * A gift-card **template**. Legacy `giftcards`.
 *
 * The card a customer holds is a `CustomerGiftCardHolding`, not this row: this is
 * the shelf item the salon sells, which is why it carries a `value` and no
 * customer. The QR payload lives here because legacy kept `qr_code` on the
 * template.
 *
 * **There is no `status` column**, so the gift-card tab draws no Status cell and
 * `?status=` is ignored rather than rejected — the tabs share one toolbar, which
 * is the same arrangement as a service ignoring `?lowStock`.
 */
export const giftCardSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  value: z.string(),
  /** Null means "never expires". Legacy `expired_date` was a **string** (Q6). */
  expiresAt: z.string().nullable(),
  remark: z.string().nullable(),
  /** Payload for the client's QR renderer, not an image. */
  qrPayload: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type GiftCardSummary = z.infer<typeof giftCardSummarySchema>;

export const giftCardDetailSchema = giftCardSummarySchema;

export type GiftCardDetail = z.infer<typeof giftCardDetailSchema>;

export const createGiftCardSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  value: moneySchema,
  /** Absent means the card never expires, which is not the same as today. */
  expiresAt: z.iso.date().optional(),
  remark: z.string().trim().max(2000).optional(),
  qrPayload: z.string().trim().max(2000).optional(),
});

export type CreateGiftCardInput = z.infer<typeof createGiftCardSchema>;

export const updateGiftCardSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  value: moneySchema.optional(),
  /** `null` removes an expiry date; absent leaves the existing one alone. */
  expiresAt: z.iso.date().nullable().optional(),
  remark: z.string().trim().max(2000).nullable().optional(),
  qrPayload: z.string().trim().max(2000).nullable().optional(),
});

export type UpdateGiftCardInput = z.infer<typeof updateGiftCardSchema>;
