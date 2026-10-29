BEGIN;
CREATE TABLE payroll_closes (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "periodKey" TEXT NOT NULL CHECK ("periodKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CALCULATED', 'APPROVED')),
  state JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("tenantId", "periodKey"),
  CHECK (state->>'periodKey' = "periodKey" AND state->>'status' = status AND (state->>'revision')::integer = revision)
);
CREATE TABLE payroll_close_events (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  "periodKey" TEXT NOT NULL,
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  reason TEXT NOT NULL,
  "previousHash" TEXT,
  "stateHash" TEXT NOT NULL,
  state JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", "periodKey", revision)
);
CREATE FUNCTION protect_payroll_close_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'payroll_close_events' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll close history is append-only';
  END IF;
  IF NEW."tenantId" <> OLD."tenantId" OR NEW."periodKey" <> OLD."periodKey" OR NEW.id <> OLD.id
     OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Payroll close identity/revision is immutable';
  END IF;
  IF OLD.status = 'APPROVED' AND (
    NEW.status <> 'APPROVED' OR OLD.state->'payout' <> 'null'::jsonb
    OR NEW.state->'payout' IS NULL OR NEW.state->'payout' = 'null'::jsonb
    OR (NEW.state - 'payout' - 'revision') IS DISTINCT FROM (OLD.state - 'payout' - 'revision')
  ) THEN
    RAISE EXCEPTION 'Approved payroll entitlement is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_close_history_guard BEFORE UPDATE OR DELETE ON payroll_closes
FOR EACH ROW EXECUTE FUNCTION protect_payroll_close_history();
CREATE TRIGGER payroll_close_audit_guard BEFORE UPDATE OR DELETE ON payroll_close_events
FOR EACH ROW EXECUTE FUNCTION protect_payroll_close_history();
COMMIT;