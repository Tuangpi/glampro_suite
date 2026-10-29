BEGIN;
CREATE FUNCTION verify_payroll_close_audit_bounds() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  close_revision INTEGER;
BEGIN
  SELECT revision INTO close_revision FROM payroll_closes
    WHERE "tenantId" = NEW."tenantId" AND "periodKey" = NEW."periodKey";
  IF close_revision IS NULL OR NEW.revision > close_revision
     OR (NEW.state->>'revision')::integer IS DISTINCT FROM NEW.revision
     OR NEW.state->>'periodKey' IS DISTINCT FROM NEW."periodKey"
     OR NEW.action NOT IN ('CALCULATE', 'ADJUST', 'APPROVE', 'PAYOUT')
     OR length(trim(NEW.reason)) NOT BETWEEN 3 AND 1000
     OR length(trim(NEW."actorId")) = 0
     OR NEW."stateHash" !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Payroll audit requires a matching committed transition';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payroll_close_audit_bounds AFTER INSERT ON payroll_close_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_payroll_close_audit_bounds();
COMMIT;