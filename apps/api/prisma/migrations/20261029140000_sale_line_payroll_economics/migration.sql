BEGIN;
ALTER TABLE sale_lines ADD COLUMN "payrollEconomics" JSONB;
CREATE FUNCTION protect_sale_line_payroll_economics() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."payrollEconomics" IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Original payroll sale economics are immutable';
    END IF;
    IF NEW."payrollEconomics" IS DISTINCT FROM OLD."payrollEconomics"
      OR NEW.id <> OLD.id OR NEW."tenantId" <> OLD."tenantId" OR NEW."saleId" <> OLD."saleId" THEN
      RAISE EXCEPTION 'Original payroll sale economics are immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sale_line_payroll_economics_guard BEFORE UPDATE OR DELETE ON sale_lines
  FOR EACH ROW EXECUTE FUNCTION protect_sale_line_payroll_economics();
COMMIT;