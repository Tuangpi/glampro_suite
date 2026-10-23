import { z } from "zod";

export const commissionKindSchema = z.enum(["SERVICE", "PRODUCT"]);
export const commissionScopeSchema = z.enum(["COMPANY", "STAFF", "DEPARTMENT", "ITEM"]);
const id = z.string().trim().min(1).max(128);
export const commissionQuerySchema = z.object({
  staffId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export const publishCommissionRuleSchema = z
  .object({
    staffId: id.nullable().default(null),
    itemKind: commissionKindSchema,
    scope: commissionScopeSchema,
    targetId: id.nullable().default(null),
    rate: z.number().min(0).max(100).multipleOf(0.01).nullable(),
    effectiveAt: z.string().datetime({ offset: true }).optional(),
    reason: z.string().trim().min(3).max(500),
    expectedRevision: id.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const company = value.scope === "COMPANY";
    const targeted = value.scope === "ITEM" || value.scope === "DEPARTMENT";
    if (
      company !== (value.staffId === null) ||
      targeted !== (value.targetId !== null) ||
      (company && value.rate === null)
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid commission scope, target or inheritance." });
    }
  });
export const commissionPreviewSchema = z
  .object({
    staffId: id,
    itemKind: commissionKindSchema,
    itemId: id,
  })
  .strict();
export const commissionOptionsQuerySchema = z.object({
  itemKind: commissionKindSchema,
  search: z.string().trim().max(160).default(""),
});
export type PublishCommissionRule = z.infer<typeof publishCommissionRuleSchema>;
export type CommissionKind = z.infer<typeof commissionKindSchema>;
export type CommissionScope = z.infer<typeof commissionScopeSchema>;
export interface CommissionRuleView {
  id: string;
  staffId: string | null;
  itemKind: CommissionKind;
  scope: CommissionScope;
  targetId: string | null;
  targetName: string | null;
  rate: string | null;
  effectiveAt: string;
  createdAt: string;
  actorId: string;
  actorName: string;
  reason: string;
}
export interface CommissionConfiguration {
  revision: string | null;
  current: CommissionRuleView[];
  scheduled: CommissionRuleView[];
  history: CommissionRuleView[];
  page: number;
  total: number;
  legacyServiceRate: string | null;
}
export interface CommissionPreview {
  rate: string;
  source: string;
  ruleId: string | null;
}
export interface CommissionOptions {
  items: { id: string; name: string }[];
  total: number;
}
