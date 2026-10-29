BEGIN;
-- Deferred so the state update and audit append can occur in the same transaction,
-- but neither can commit independently, including direct SQL/Prisma writes.
CREATE FUNCTION verify_payroll_close_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_close payroll_closes%ROWTYPE;
  current_audit payroll_close_events%ROWTYPE;
  previous_audit payroll_close_events%ROWTYPE;
BEGIN
  SELECT * INTO current_close FROM payroll_closes
    WHERE "tenantId" = NEW."tenantId" AND "periodKey" = NEW."periodKey";
  SELECT * INTO current_audit FROM payroll_close_events
    WHERE "tenantId" = NEW."tenantId" AND "periodKey" = NEW."periodKey" AND revision = NEW.revision;
  IF current_close.id IS NULL OR current_audit.id IS NULL
     OR current_audit.state IS DISTINCT FROM NEW.state THEN
    RAISE EXCEPTION 'Payroll close transition requires matching atomic audit';
  END IF;
  IF current_close.revision = NEW.revision AND current_close.state IS DISTINCT FROM current_audit.state THEN
    RAISE EXCEPTION 'Payroll close snapshot does not match audit';
  END IF;
  IF NEW.revision = 1 THEN
    IF current_audit."previousHash" IS NOT NULL THEN
      RAISE EXCEPTION 'Initial payroll audit cannot have a previous hash';
    END IF;
  ELSE
    SELECT * INTO previous_audit FROM payroll_close_events
      WHERE "tenantId" = NEW."tenantId" AND "periodKey" = NEW."periodKey" AND revision = NEW.revision - 1;
    IF previous_audit.id IS NULL OR current_audit."previousHash" IS DISTINCT FROM previous_audit."stateHash" THEN
      RAISE EXCEPTION 'Payroll close audit chain is incomplete';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payroll_close_atomic_audit AFTER INSERT OR UPDATE ON payroll_closes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_payroll_close_audit();
CREATE CONSTRAINT TRIGGER payroll_close_audit_atomic_state AFTER INSERT ON payroll_close_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_payroll_close_audit();
COMMIT;