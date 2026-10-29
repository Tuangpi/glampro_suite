BEGIN;
CREATE TABLE payroll_carry_authorizations (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('OPENING', 'SETTLEMENT')),
  "periodKey" TEXT NOT NULL CHECK ("periodKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  "targetId" TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  "actorId" TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  payload JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", kind, "periodKey", "targetId", revision),
  FOREIGN KEY ("actorId") REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (payload->>'id' = id AND payload->>'tenantId' = "tenantId"
    AND payload->>'periodKey' = "periodKey" AND (payload->>'revision')::integer = revision
    AND payload->'approval'->>'actorId' = "actorId" AND payload->'approval'->>'reason' = reason),
  CHECK ((kind = 'OPENING' AND "targetId" = 'opening') OR
    (kind = 'SETTLEMENT' AND "targetId" = payload->>'staffId'))
);
CREATE INDEX payroll_carry_authorizations_scope_idx ON payroll_carry_authorizations("tenantId", kind, "periodKey");
CREATE FUNCTION verify_payroll_carry_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW."actorId" AND "tenantId" = NEW."tenantId"
    AND "globalRole" = 'SUPER_ADMIN' AND NOT disabled AND "twoFactorEnabled") THEN
    RAISE EXCEPTION 'Payroll carry authorization requires a verified salon owner';
  END IF;
  IF NEW.payload->'approval'->>'at' IS NULL OR
    (NEW.payload->'approval'->>'at')::timestamptz <> NEW."createdAt" AT TIME ZONE 'UTC' THEN
    RAISE EXCEPTION 'Payroll carry authorization time mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_carry_owner_guard BEFORE INSERT ON payroll_carry_authorizations
  FOR EACH ROW EXECUTE FUNCTION verify_payroll_carry_owner();
CREATE TRIGGER payroll_carry_authorizations_immutable BEFORE UPDATE OR DELETE ON payroll_carry_authorizations
  FOR EACH ROW EXECUTE FUNCTION protect_payroll_configuration();
COMMIT;