-- No historical backfill or activation. Existing rows remain explicitly legacy.
ALTER TABLE employee_commissions ALTER COLUMN amount TYPE DECIMAL(24,10);
ALTER TABLE employee_commissions
  ADD COLUMN "ledgerVersion" INTEGER,
  ADD COLUMN "eventKey" TEXT,
  ADD COLUMN "eventHash" TEXT,
  ADD COLUMN kind TEXT,
  ADD COLUMN "entryType" TEXT,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "occurredAt" TIMESTAMP(3),
  ADD COLUMN "periodId" TEXT,
  ADD COLUMN currency TEXT,
  ADD COLUMN share INTEGER,
  ADD COLUMN "actorId" TEXT,
  ADD COLUMN reason TEXT,
  ADD COLUMN snapshot JSONB,
  ADD COLUMN "reversesId" TEXT;

CREATE TABLE commission_periods (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  timezone TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT commission_period_positive CHECK ("startsAt" < "endsAt"),
  CONSTRAINT commission_period_lock_approval CHECK ("lockedAt" IS NULL OR "approvedAt" IS NOT NULL),
  UNIQUE ("tenantId", id)
);
CREATE INDEX "commission_periods_tenantId_startsAt_endsAt_idx" ON commission_periods("tenantId", "startsAt", "endsAt");
CREATE UNIQUE INDEX "employee_commissions_tenantId_eventKey_key" ON employee_commissions("tenantId", "eventKey");
CREATE UNIQUE INDEX "employee_commissions_tenantId_reversesId_key" ON employee_commissions("tenantId", "reversesId");
CREATE INDEX "employee_commissions_tenantId_periodId_userId_kind_idx" ON employee_commissions("tenantId", "periodId", "userId", kind);
ALTER TABLE employee_commissions ADD CONSTRAINT commission_period_tenant_fk
  FOREIGN KEY ("tenantId", "periodId") REFERENCES commission_periods("tenantId", id) ON DELETE RESTRICT;
ALTER TABLE employee_commissions ADD CONSTRAINT commission_event_complete CHECK (
  "ledgerVersion" IS NULL OR (
    "ledgerVersion" = 1 AND "eventKey" IS NOT NULL AND "eventHash" IS NOT NULL
    AND kind IN ('SERVICE','PRODUCT','PACKAGE_SALE','PACKAGE_REDEMPTION','FOC','STORED_CREDIT_SALE','STORED_CREDIT_SPEND')
    AND "entryType" IN ('EARNING','REVERSAL','ADJUSTMENT')
    AND "sourceType" IS NOT NULL AND "sourceId" IS NOT NULL AND "occurredAt" IS NOT NULL
    AND "periodId" IS NOT NULL AND currency ~ '^[A-Z]{3}$' AND share BETWEEN 1 AND 10000
    AND "actorId" IS NOT NULL AND reason IS NOT NULL AND snapshot IS NOT NULL
    AND basis IS NOT NULL AND rate BETWEEN 0 AND 100
    AND (("entryType" = 'REVERSAL' AND "reversesId" IS NOT NULL AND amount <= 0)
      OR ("entryType" <> 'REVERSAL' AND "reversesId" IS NULL AND amount >= 0))
  ) IS TRUE
);

CREATE FUNCTION guard_commission_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."ledgerVersion" IS NOT NULL OR (TG_OP = 'UPDATE' AND NEW."ledgerVersion" IS NOT NULL) THEN
    RAISE EXCEPTION 'Commission event evidence is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commission_event_immutable BEFORE UPDATE OR DELETE ON employee_commissions
  FOR EACH ROW EXECUTE FUNCTION guard_commission_event();

CREATE FUNCTION guard_commission_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serializes overlapping period creation and posting/locking using the publisher lock.
  PERFORM id FROM tenants WHERE id = NEW."tenantId" FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."lockedAt" IS NOT NULL OR NEW."tenantId" <> OLD."tenantId"
      OR NEW."startsAt" <> OLD."startsAt" OR NEW."endsAt" <> OLD."endsAt"
      OR NEW.timezone <> OLD.timezone THEN
      RAISE EXCEPTION 'Commission period boundaries and locked periods are immutable';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Unknown commission business timezone';
  END IF;
  IF EXISTS (SELECT 1 FROM commission_periods p WHERE p."tenantId" = NEW."tenantId"
    AND p.id <> NEW.id AND p."startsAt" < NEW."endsAt" AND p."endsAt" > NEW."startsAt") THEN
    RAISE EXCEPTION 'Commission periods must not overlap';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commission_period_guard BEFORE INSERT OR UPDATE ON commission_periods
  FOR EACH ROW EXECUTE FUNCTION guard_commission_period();

CREATE FUNCTION validate_commission_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original employee_commissions;
BEGIN
  IF NEW."ledgerVersion" IS NULL THEN RETURN NEW; END IF;
  PERFORM id FROM tenants WHERE id = NEW."tenantId" FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM commission_periods p WHERE p.id = NEW."periodId"
    AND p."tenantId" = NEW."tenantId" AND p."lockedAt" IS NULL
    AND NEW."occurredAt" >= p."startsAt" AND NEW."occurredAt" < p."endsAt") THEN
    RAISE EXCEPTION 'Commission posting period is closed or out of bounds';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW."userId" AND "tenantId" = NEW."tenantId")
    OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW."actorId" AND "tenantId" = NEW."tenantId" AND NOT disabled)
    OR (NEW."saleId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sales WHERE id = NEW."saleId" AND "tenantId" = NEW."tenantId"))
    OR (NEW."saleLineId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sale_lines WHERE id = NEW."saleLineId" AND "tenantId" = NEW."tenantId" AND "saleId" = NEW."saleId")) THEN
    RAISE EXCEPTION 'Commission source, staff or actor tenant mismatch';
  END IF;
  IF NEW."entryType" = 'REVERSAL' THEN
    SELECT * INTO original FROM employee_commissions WHERE id = NEW."reversesId"
      AND "tenantId" = NEW."tenantId" AND "ledgerVersion" = 1 AND "entryType" <> 'REVERSAL';
    IF NOT FOUND OR NEW.amount <> -original.amount OR NEW.basis <> -original.basis
      OR NEW."userId" <> original."userId" OR NEW.kind <> original.kind
      OR NEW.rate <> original.rate OR NEW.share <> original.share
      OR NEW.currency <> original.currency OR NEW.snapshot <> original.snapshot THEN
      RAISE EXCEPTION 'Commission reversal must preserve original evidence and negate exact values';
    END IF;
  ELSIF NEW.amount <> NEW.basis * NEW.rate * NEW.share / 1000000 THEN
    RAISE EXCEPTION 'Commission precision does not match snapshot';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commission_posting_guard BEFORE INSERT ON employee_commissions
  FOR EACH ROW EXECUTE FUNCTION validate_commission_posting();