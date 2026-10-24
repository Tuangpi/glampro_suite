import { z } from "zod";
import { salonOperatingHoursSchema } from "./settings.js";

/** A full-week override. Null on the outlet inherits company hours. */
export const outletOperatingHoursSchema = salonOperatingHoursSchema
  .omit({ tenantId: true })
  .strict();
export type OutletOperatingHours = z.infer<typeof outletOperatingHoursSchema>;

const outletFields = {
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  status: z.enum(["ACTIVE", "SUSPENDED"]).default("ACTIVE"),
  address: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  operatingHours: outletOperatingHoursSchema.nullable().optional(),
  timeZone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Invalid time zone")
    .optional(),
  locale: z
    .string()
    .max(40)
    .refine((value) => {
      try {
        return Intl.DateTimeFormat.supportedLocalesOf([value]).length === 1;
      } catch {
        return false;
      }
    }, "Invalid locale")
    .optional(),
};

export const createOutletSchema = z.strictObject(outletFields);
export const updateOutletSchema = createOutletSchema
  .omit({ status: true })
  .partial()
  .extend({
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field");
export const outletSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  timeZone: z.string(),
  locale: z.string(),
  operatingHours: outletOperatingHoursSchema.nullable().optional(),
});
export const outletAssignmentSchema = z.strictObject({
  kind: z.enum(["PRODUCT", "PACKAGE"]),
  id: z.string().min(1).max(64),
  outletId: z.string().min(1).max(64).nullable(),
});
export type CreateOutletInput = z.infer<typeof createOutletSchema>;
export type UpdateOutletInput = z.infer<typeof updateOutletSchema>;
export type OutletSummary = z.infer<typeof outletSummarySchema>;
export type OutletAssignmentInput = z.infer<typeof outletAssignmentSchema>;
