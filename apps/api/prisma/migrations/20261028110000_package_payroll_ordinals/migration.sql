BEGIN;
ALTER TABLE customer_package_holdings ADD COLUMN "payrollAvailableOrdinals" JSONB;
ALTER TABLE customer_package_holdings ADD CONSTRAINT package_payroll_ordinals_check
  CHECK ("payrollAvailableOrdinals" IS NULL OR
    ("payrollPurchaseSnapshot" IS NOT NULL AND jsonb_typeof("payrollAvailableOrdinals") = 'array'));
CREATE FUNCTION protect_package_payroll_ordinals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."payrollAvailableOrdinals" IS NULL AND NEW."payrollAvailableOrdinals" IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot infer original payroll ordinals on an existing holding';
  END IF;
  IF OLD."payrollAvailableOrdinals" IS NOT NULL AND NEW."payrollAvailableOrdinals" IS NULL THEN
    RAISE EXCEPTION 'Cannot clear captured payroll ordinals';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER package_payroll_ordinals_guard BEFORE UPDATE ON customer_package_holdings
  FOR EACH ROW EXECUTE FUNCTION protect_package_payroll_ordinals();
COMMIT;