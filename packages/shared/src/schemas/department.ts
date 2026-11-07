import { z } from "zod";

/** Departments are salon sections, not physical outlets. */
export const saveDepartmentSchema = z
  .object({ name: z.string().trim().min(1, "Enter a department name.").max(100) })
  .strict();

export type SaveDepartmentInput = z.infer<typeof saveDepartmentSchema>;

export const departmentDeletionImpactSchema = z.object({
  id: z.string(),
  name: z.string(),
  products: z.number().int().nonnegative(),
  services: z.number().int().nonnegative(),
  staff: z.number().int().nonnegative(),
  customers: z.number().int().nonnegative(),
  commissionRules: z.number().int().nonnegative(),
});

export type DepartmentDeletionImpact = z.infer<typeof departmentDeletionImpactSchema>;
