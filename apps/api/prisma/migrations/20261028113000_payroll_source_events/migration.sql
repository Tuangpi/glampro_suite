BEGIN;
CREATE TABLE payroll_source_events (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "sourceKey" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "outletId" TEXT,
  "actorId" TEXT,
  reason TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  evidence JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", "sourceKey")
);
CREATE INDEX payroll_source_events_sale_idx ON payroll_source_events("tenantId", "saleId");
CREATE FUNCTION protect_payroll_source_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Payroll source events are append-only; reverse and repost with a reason';
END;
$$;
CREATE TRIGGER payroll_source_events_immutable BEFORE UPDATE OR DELETE ON payroll_source_events
  FOR EACH ROW EXECUTE FUNCTION protect_payroll_source_events();
ALTER TABLE customer_value_package_holdings ADD COLUMN "payrollPurchaseSnapshot" JSONB;
CREATE FUNCTION protect_payroll_value_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."payrollPurchaseSnapshot" IS DISTINCT FROM OLD."payrollPurchaseSnapshot" THEN
    RAISE EXCEPTION 'Value-package payroll purchase snapshots cannot be rewritten or backfilled';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_value_purchase_immutable BEFORE UPDATE ON customer_value_package_holdings
  FOR EACH ROW EXECUTE FUNCTION protect_payroll_value_purchase();
COMMIT;