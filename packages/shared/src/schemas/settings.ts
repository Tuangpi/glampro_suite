/**
 * Settings contracts — handoff screen 11, `/api/settings`.
 *
 * The MVP's settings page answers three questions and nothing else
 * (`docs/mvp.md` → M4): what this salon **is** (profile), what it has **bought**
 * (modules, read-only), and who **works here** (the staff/roles summary, which
 * is `GET /api/staff` read from the page rather than a second endpoint that
 * could disagree with it).
 *
 * The profile owns the salon name, low-stock threshold and localisation
 * preferences. `slug` and `status` belong to the
 * platform console (a salon cannot rename its own isolation key or un-suspend
 * itself), the receipt counter is the till's, and ADR 0010 explicitly deferred
 * `lowStockThreshold`'s field to "Settings (Phase 8)" — so this is the screen
 * that finally gives it one. Hours, tax and receipt configuration are full-phase
 * work: each needs columns the schema does not have yet, and inventing them
 * here would make the screen lie about what it persists.
 */
import { z } from "zod";

// The tenant status enum already exists — `auth.ts` declares it for the sign-in
// refusal rules — so settings *uses* it rather than declaring a second list that
// could drift from the database's own.
import { tenantStatusSchema } from "./auth.js";

export const salonTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en-SG", { timeZone: value });
        return !/^[+-]/.test(value);
      } catch {
        return false;
      }
    },
    { message: "Enter a valid timezone, such as Asia/Singapore" },
  );

export const salonLocaleSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (value) => {
      try {
        return Intl.DateTimeFormat.supportedLocalesOf([value]).length === 1;
      } catch {
        return false;
      }
    },
    { message: "Enter a supported formatting locale, such as en-SG" },
  );

/** `GET /api/settings/profile` */
export const salonProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Read-only: renaming the slug would break every bookmarked tenant path. */
  slug: z.string(),
  /** Read-only: suspension is the platform console's verdict, not the salon's. */
  status: tenantStatusSchema,
  /** "Low" for the rail badge and the low-stock filter (ADR 0010). */
  lowStockThreshold: z.number().int().min(0).max(10_000),
  timeZone: salonTimeZoneSchema,
  locale: salonLocaleSchema,
  /** GST toggle (TK2610-0009 / P0-01): catalogue prices include GST when on. */
  gstEnabled: z.boolean(),
  /** GST registration number printed on receipts and reports; `null` when unset. */
  gstRegistrationNumber: z.string().nullable(),
  /** Online booking (TK2610-0022). */
  onlineBookingEnabled: z.boolean(),
  onlineDepositAmount: z.number().int().min(0),
  onlineNoShowFee: z.number().int().min(0),
  /**
   * Salon-wide staff sign-in policy: every non-owner member must pass an email
   * code at sign-in. Read-only here and written through `PATCH /settings/security`,
   * because the profile form's body carries unrelated required fields and a
   * security switch must not depend on them.
   */
  requireStaffTwoFactor: z.boolean(),
  /**
   * Where the salon's logo can be read — `/api/public/tenants/{slug}/logo`, a
   * relative path so it resolves through the web app's own origin (and its dev
   * proxy). `null` until a manager uploads one; every surface that shows it falls
   * back to the salon's initials.
   *
   * Read-only here, and written through `POST`/`DELETE /api/settings/logo` rather
   * than the profile form: an image is a body of its own, not a JSON field.
   */
  logoUrl: z.string().nullable(),
  owner: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
  /**
   * When the salon's subscription lapses — the latest `Subscription.endDate`,
   * `null` when no plan is recorded. Read-only: expiry is the platform
   * console's verdict, and `updateSalonProfileSchema` is strict, so sending it
   * back is a validation error rather than a silent write.
   */
  subscriptionEndsAt: z.string().nullable(),

  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SalonProfile = z.infer<typeof salonProfileSchema>;

export const gstRegistrationNumberSchema = z
  .string()
  .trim()
  .min(1, "GST registration number is required when GST is enabled.")
  .max(50)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/, "Use letters, digits, spaces, dots, slashes or hyphens.");

/**
 * `PATCH /api/settings/profile` — the salon's editable profile fields.
 *
 * Keep the existing required name/threshold contract. New preferences are optional:
 * older clients must not reset saved localisation when editing the profile.
 */
export const updateSalonProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    lowStockThreshold: z.number().int().min(0).max(10_000),
    timeZone: salonTimeZoneSchema.optional(),
    locale: salonLocaleSchema.optional(),
    /**
     * GST toggle (TK2610-0009 / P0-01). Optional so older clients do not flip
     * a salon's tax behaviour by omitting it; only a sent value changes it.
     */
    gstEnabled: z.boolean().optional(),
    /**
     * GST registration number. `null` clears it. The service refuses enabling
     * GST without a number and refuses clearing it while GST stays enabled,
     * so the stored pair can never be "enabled but unnumbered".
     */
    gstRegistrationNumber: gstRegistrationNumberSchema.nullable().optional(),
    onlineBookingEnabled: z.boolean().optional(),
    onlineDepositAmount: z.number().int().min(0).optional(),
    onlineNoShowFee: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    // Explicit `null` with the toggle on is always wrong. An **omitted** number
    // is the service's call, because only it can see the stored one.
    (input) => input.gstEnabled !== true || input.gstRegistrationNumber !== null,
    {
      message: "A GST registration number is required when GST is enabled.",
      path: ["gstRegistrationNumber"],
    },
  );

export type UpdateSalonProfileInput = z.infer<typeof updateSalonProfileSchema>;

/**
 * `PATCH /api/settings/security` — the salon's sign-in policy.
 *
 * A request of its own rather than a field on the profile: `name` and
 * `lowStockThreshold` are required by `updateSalonProfileSchema`, so riding along
 * would force the switch to resend unrelated fields it does not own, and a
 * failure to load the profile would silently block a security decision.
 *
 * `strict()` and a required boolean: an omitted key is a mistake here, and it must
 * not be read as "leave it alone" or as `false`.
 */
export const updateSalonSecuritySchema = z
  .object({
    requireStaffTwoFactor: z.boolean(),
  })
  .strict();

export type UpdateSalonSecurityInput = z.infer<typeof updateSalonSecuritySchema>;

/**
 * One row of the modules panel: what the catalogue offers and whether **this**
 * salon may use it now.
 *
 * `entitled` is computed by the same rule `requireModule` enforces (core passes
 * as soon as the tenant exists, an add-on needs a live `TenantModule` row), so
 * the panel and the routes can never disagree about a lapsed grant — the panel
 * is a read of the boundary, not a second implementation of it.
 */
export const moduleSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  category: z.string(),
  isCore: z.boolean(),
  entitled: z.boolean(),
  /** When the salon's grant lapses. `null` = core or open-ended. */
  expiresAt: z.string().nullable(),
});

export type ModuleSummary = z.infer<typeof moduleSummarySchema>;

/** One day's open window. A `null` day means the salon is closed that day. */
export const dayHoursSchema = z
  .object({
    open: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm, such as 09:00"),
    close: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm, such as 20:00"),
  })
  .refine((data) => data.open < data.close, {
    message: "Closing time must be after opening time",
    path: ["close"],
  });

export type DayHours = z.infer<typeof dayHoursSchema>;

/**
 * `GET /api/settings/hours` — the salon's published operating hours.
 *
 * One row per day of the week, Sunday first. `null` = closed.
 */
export const salonOperatingHoursSchema = z.object({
  tenantId: z.string(),
  sunday: dayHoursSchema.nullable(),
  monday: dayHoursSchema.nullable(),
  tuesday: dayHoursSchema.nullable(),
  wednesday: dayHoursSchema.nullable(),
  thursday: dayHoursSchema.nullable(),
  friday: dayHoursSchema.nullable(),
  saturday: dayHoursSchema.nullable(),
});

export type SalonOperatingHours = z.infer<typeof salonOperatingHoursSchema>;

/**
 * `PATCH /api/settings/hours` — the salon's editable operating hours.
 *
 * Only the days being changed are sent; omitted days are left untouched. At
 * least one day must be provided.
 */
export const updateSalonOperatingHoursSchema = z
  .object({
    sunday: dayHoursSchema.nullable().optional(),
    monday: dayHoursSchema.nullable().optional(),
    tuesday: dayHoursSchema.nullable().optional(),
    wednesday: dayHoursSchema.nullable().optional(),
    thursday: dayHoursSchema.nullable().optional(),
    friday: dayHoursSchema.nullable().optional(),
    saturday: dayHoursSchema.nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one day must be provided" });

export type UpdateSalonOperatingHoursInput = z.infer<typeof updateSalonOperatingHoursSchema>;
