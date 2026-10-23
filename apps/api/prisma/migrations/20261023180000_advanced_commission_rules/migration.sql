BEGIN;

CREATE TABLE "commission_rules" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "staffId" TEXT,
  "itemKind" TEXT NOT NULL CHECK ("itemKind" IN ('SERVICE', 'PRODUCT')),
  "scope" TEXT NOT NULL CHECK ("scope" IN ('COMPANY', 'STAFF', 'DEPARTMENT', 'ITEM')),
  "targetId" TEXT,
  "scopeKey" TEXT NOT NULL,
  "rate" DECIMAL(5,2) CHECK ("rate" >= 0 AND "rate" <= 100),
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  CONSTRAINT "commission_rule_scope" CHECK (
    ("scope" = 'COMPANY' AND "staffId" IS NULL AND "targetId" IS NULL AND "rate" IS NOT NULL) OR
    ("scope" = 'STAFF' AND "staffId" IS NOT NULL AND "targetId" IS NULL) OR
    ("scope" IN ('DEPARTMENT', 'ITEM') AND "staffId" IS NOT NULL AND "targetId" IS NOT NULL)
  )
);
CREATE INDEX "commission_rules_tenantId_staffId_effectiveAt_idx" ON "commission_rules"("tenantId", "staffId", "effectiveAt");
CREATE INDEX "commission_rules_tenantId_scopeKey_effectiveAt_idx" ON "commission_rules"("tenantId", "scopeKey", "effectiveAt");

ALTER TABLE "employee_commissions"
  ADD COLUMN "saleLineId" TEXT,
  ADD COLUMN "basis" DECIMAL(12,2),
  ADD COLUMN "ruleId" TEXT,
  ADD COLUMN "ruleSource" TEXT;

ALTER TABLE "sale_lines" ADD COLUMN "commissionSnapshot" JSONB;

-- Prevent accidental rewriting of published rules. Tenant deletion can still cascade.
CREATE FUNCTION commission_rule_no_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Commission rules are append-only; publish a replacement';
END;
$$;
CREATE TRIGGER commission_rule_no_update BEFORE UPDATE ON "commission_rules"
  FOR EACH ROW EXECUTE FUNCTION commission_rule_no_update();

CREATE FUNCTION commission_rule_no_direct_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'Commission rules are append-only; publish an inheritance event';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER commission_rule_no_direct_delete BEFORE DELETE ON "commission_rules"
  FOR EACH ROW EXECUTE FUNCTION commission_rule_no_direct_delete();

COMMIT;