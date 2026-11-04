BEGIN;
CREATE TABLE payroll_cutovers (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ROLLED_BACK')),
  "effectivePeriodKey" TEXT NOT NULL CHECK ("effectivePeriodKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  state JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK (state->>'status' = status AND (state->>'revision')::integer = revision
    AND state->>'effectivePeriodKey' = "effectivePeriodKey")
);
CREATE TABLE payroll_cutover_events (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  action TEXT NOT NULL CHECK (action IN ('ACTIVATE', 'ROLLBACK')),
  "actorId" TEXT NOT NULL,
  reason TEXT NOT NULL,
  "previousHash" TEXT,
  "stateHash" TEXT NOT NULL,
  state JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", revision),
  CHECK ((revision = 1) = ("previousHash" IS NULL))
);
-- One activation row per salon: the first event must both create it and carry no predecessor.
CREATE FUNCTION protect_payroll_cutover_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'payroll_cutover_events' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll cutover history is append-only';
  END IF;
  IF NEW."tenantId" <> OLD."tenantId" OR NEW.id <> OLD.id
     OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Payroll cutover identity/revision is immutable';
  END IF;
  IF NOT ((OLD.status = 'ACTIVE' AND NEW.status = 'ROLLED_BACK')
       OR (OLD.status = 'ROLLED_BACK' AND NEW.status = 'ACTIVE')) THEN
    RAISE EXCEPTION 'Payroll cutover status must alternate between active and rolled back';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_cutover_history_guard BEFORE UPDATE OR DELETE ON payroll_cutovers
FOR EACH ROW EXECUTE FUNCTION protect_payroll_cutover_history();
CREATE TRIGGER payroll_cutover_audit_guard BEFORE UPDATE OR DELETE ON payroll_cutover_events
FOR EACH ROW EXECUTE FUNCTION protect_payroll_cutover_history();
COMMIT;
