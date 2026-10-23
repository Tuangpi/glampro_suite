import type { CommissionKind, CommissionPreview } from "@glampro_suite/shared";

export interface RuleCandidate {
  id: string;
  staffId: string | null;
  itemKind: string;
  scope: string;
  targetId: string | null;
  rate: { toString(): string } | null;
  effectiveAt: Date;
  createdAt: Date;
}

export function commissionScopeKey(
  staffId: string | null,
  kind: string,
  scope: string,
  targetId: string | null,
) {
  return JSON.stringify([staffId, kind, scope, targetId]);
}

/** Latest published event wins at each level; null is inheritance, not zero. */
export function resolveCommission(
  rules: RuleCandidate[],
  input: {
    staffId: string;
    itemKind: CommissionKind;
    itemId: string;
    departmentId: string | null;
    legacyServiceRate: string;
  },
  at: Date,
): CommissionPreview {
  const candidates = rules
    .filter((rule) => rule.itemKind === input.itemKind && rule.effectiveAt <= at)
    .sort(
      (a, b) =>
        b.effectiveAt.getTime() - a.effectiveAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    );
  for (const scope of ["ITEM", "DEPARTMENT", "STAFF", "COMPANY"]) {
    const rule = candidates.find(
      (row) =>
        row.scope === scope &&
        row.staffId === (scope === "COMPANY" ? null : input.staffId) &&
        row.targetId ===
          (scope === "ITEM" ? input.itemId : scope === "DEPARTMENT" ? input.departmentId : null) &&
        (scope !== "DEPARTMENT" || input.departmentId !== null),
    );
    if (rule?.rate !== null && rule?.rate !== undefined)
      return { rate: rule.rate.toString(), source: scope, ruleId: rule.id };
    // No explicit staff configuration preserves the old per-staff service rate,
    // including zero. Publishing null intentionally opts into company inheritance.
    if (scope === "STAFF" && !rule && input.itemKind === "SERVICE")
      return { rate: input.legacyServiceRate, source: "LEGACY_STAFF", ruleId: null };
  }
  return { rate: "0", source: "NONE", ruleId: null };
}
