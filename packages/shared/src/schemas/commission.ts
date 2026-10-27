import { z } from "zod";

export const commissionKindSchema = z.enum([
  "SERVICE",
  "PRODUCT",
  "PACKAGE_SALE",
  "PACKAGE_REDEMPTION",
  "FOC",
  "STORED_CREDIT_SALE",
  "STORED_CREDIT_SPEND",
]);
export const catalogueCommissionKindSchema = commissionKindSchema;
export const commissionScopeSchema = z.enum(["COMPANY", "STAFF", "DEPARTMENT", "ITEM", "PACKAGE"]);
export const COMMISSION_KIND_LABELS = {
  SERVICE: "Services",
  PRODUCT: "Products",
  PACKAGE_SALE: "Package sales",
  PACKAGE_REDEMPTION: "Package redemptions",
  FOC: "Complimentary services (FOC)",
  STORED_CREDIT_SALE: "Stored-credit sales",
  STORED_CREDIT_SPEND: "Stored-credit spending",
} as const;
const id = z.string().trim().min(1).max(128);
export const commissionQuerySchema = z.object({
  staffId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export const publishCommissionRuleSchema = z
  .object({
    staffId: id.nullable().default(null),
    itemKind: catalogueCommissionKindSchema,
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
    const packageOverride = value.scope === "PACKAGE";
    const targeted = ["ITEM", "DEPARTMENT", "PACKAGE"].includes(value.scope);
    if (
      (company || packageOverride) !== (value.staffId === null) ||
      targeted !== (value.targetId !== null) ||
      (company && value.rate === null) ||
      (packageOverride &&
        ![
          "PACKAGE_SALE",
          "PACKAGE_REDEMPTION",
          "STORED_CREDIT_SALE",
          "STORED_CREDIT_SPEND",
        ].includes(value.itemKind)) ||
      (value.scope === "DEPARTMENT" && !["SERVICE", "PRODUCT", "FOC"].includes(value.itemKind))
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid commission scope, target or inheritance." });
    }
  });
export const commissionPreviewSchema = z
  .object({
    staffId: id,
    itemKind: catalogueCommissionKindSchema,
    itemId: id,
  })
  .strict();
export const commissionOptionsQuerySchema = z.object({
  itemKind: catalogueCommissionKindSchema,
  search: z.string().trim().max(160).default(""),
});
export const bulkPublishCommissionRulesSchema = z
  .object({
    expectedRevision: id.nullable(),
    reason: z.string().trim().min(3).max(500),
    effectiveAt: z.string().datetime({ offset: true }).optional(),
    rules: z
      .array(
        z
          .object({
            staffId: id.nullable().default(null),
            itemKind: commissionKindSchema,
            scope: commissionScopeSchema,
            targetId: id.nullable().default(null),
            rate: z.number().min(0).max(100).multipleOf(0.01).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    value.rules.forEach((rule, index) => {
      const result = publishCommissionRuleSchema.safeParse({
        ...rule,
        expectedRevision: value.expectedRevision,
        reason: value.reason,
        effectiveAt: value.effectiveAt,
      });
      if (!result.success)
        for (const issue of result.error.issues)
          ctx.addIssue({
            code: "custom",
            path: ["rules", index, ...issue.path],
            message: issue.message,
          });
    });
    const keys = value.rules.map((rule) =>
      JSON.stringify([rule.staffId, rule.itemKind, rule.scope, rule.targetId]),
    );
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: "custom",
        message: "A bulk publication cannot repeat the same rule scope.",
      });
  });
export const commissionMatrixQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    search: z.string().trim().max(160).default(""),
  })
  .strict();
export type BulkPublishCommissionRules = z.infer<typeof bulkPublishCommissionRulesSchema>;
export interface CommissionMatrix {
  revision: string | null;
  page: number;
  total: number;
  rows: {
    staffId: string;
    name: string;
    cells: {
      itemKind: CommissionKind;
      configuredRate: string | null;
      configured: boolean;
      rate: string;
      source: string;
    }[];
  }[];
}
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

/** Internal posting contract, not a public request or permission grant. */
export const commissionEventSchema = z
  .object({
    eventKey: id,
    kind: commissionKindSchema,
    userId: id,
    actorId: id,
    sourceType: z.enum([
      "SALE_LINE",
      "COLLECTION_ALLOCATION",
      "REDEMPTION",
      "CREDIT_SPEND",
      "MANUAL",
    ]),
    sourceId: id,
    saleId: id.nullable(),
    saleLineId: id.nullable(),
    occurredAt: z.string().datetime({ offset: true }),
    periodId: id,
    currency: z.string().regex(/^[A-Z]{3}$/),
    basis: z.string().regex(/^(0|[1-9]\d{0,9})\.\d{2}$/),
    rate: z.string().regex(/^(?:\d{1,2}\.\d{2}|100\.00)$/),
    share: z.number().int().min(1).max(10000),
    ruleId: id.nullable(),
    ruleSource: z.string().min(1).max(64),
    reason: z.string().trim().min(3).max(500),
    /** Internal immutable attribution/value link; never accepted from a POS request. */
    redemptionEvidence: z
      .object({
        snapshotId: id,
        sourceOccurredAt: z.string().datetime({ offset: true }),
        correctsSnapshotId: id.nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CommissionEvent = z.infer<typeof commissionEventSchema>;
