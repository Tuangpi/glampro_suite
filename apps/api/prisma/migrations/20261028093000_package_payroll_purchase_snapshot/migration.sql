-- Prospective evidence only. No legacy backfill and no payroll activation.
ALTER TABLE customer_package_holdings ADD COLUMN "payrollPurchaseSnapshot" JSONB;
ALTER TABLE customer_package_holdings ADD CONSTRAINT package_payroll_purchase_object_check
  CHECK ("payrollPurchaseSnapshot" IS NULL OR jsonb_typeof("payrollPurchaseSnapshot") = 'object');

CREATE FUNCTION guard_package_payroll_purchase_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."payrollPurchaseSnapshot" IS DISTINCT FROM OLD."payrollPurchaseSnapshot" THEN
    RAISE EXCEPTION 'Original package payroll purchase evidence is immutable; legacy evidence cannot be inferred';
  END IF;
  -- Ownership/balance/expiry may change, but not the source of captured economics.
  IF OLD."payrollPurchaseSnapshot" IS NOT NULL AND (
    NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR
    NEW."saleLineId" IS DISTINCT FROM OLD."saleLineId" OR
    NEW."packageId" IS DISTINCT FROM OLD."packageId" OR
    NEW.quantity IS DISTINCT FROM OLD.quantity
  ) THEN
    RAISE EXCEPTION 'Captured package payroll source and original grant are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER package_payroll_purchase_snapshot_guard BEFORE UPDATE ON customer_package_holdings
  FOR EACH ROW EXECUTE FUNCTION guard_package_payroll_purchase_snapshot();