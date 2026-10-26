-- No historical reconstruction and no commission activation.
CREATE TABLE commission_redemption_snapshots (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "redemptionId" TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  "eventKey" TEXT NOT NULL,
  "eventHash" TEXT NOT NULL,
  "eventType" TEXT NOT NULL CHECK ("eventType" IN ('CAPTURE','CORRECTION','VOID')),
  "actorId" TEXT,
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "commission_redemption_snapshots_tenantId_redemptionId_revision_key"
  ON commission_redemption_snapshots("tenantId", "redemptionId", revision);
CREATE UNIQUE INDEX "commission_redemption_snapshots_tenantId_eventKey_key"
  ON commission_redemption_snapshots("tenantId", "eventKey");
CREATE INDEX "commission_redemption_snapshots_tenantId_redemptionId_createdAt_idx"
  ON commission_redemption_snapshots("tenantId", "redemptionId", "createdAt");

CREATE FUNCTION guard_commission_redemption_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Commission redemption evidence is append-only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customer_redemptions r
    WHERE r.id = NEW."redemptionId" AND r."tenantId" = NEW."tenantId" AND r."itemType" = 'PACKAGE')
    OR (NEW."actorId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = NEW."actorId" AND u."tenantId" = NEW."tenantId" AND NOT u.disabled)) THEN
    RAISE EXCEPTION 'Commission redemption source or actor tenant mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commission_redemption_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE
  ON commission_redemption_snapshots FOR EACH ROW EXECUTE FUNCTION guard_commission_redemption_snapshot();

CREATE TABLE commission_attribution_policies (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "requireSellers" BOOLEAN NOT NULL,
  "requireServicePerformers" BOOLEAN NOT NULL,
  "requireRedemptionPerformers" BOOLEAN NOT NULL,
  "actorId" TEXT NOT NULL,
  reason TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "commission_attribution_policies_tenantId_createdAt_id_idx"
  ON commission_attribution_policies("tenantId", "createdAt", id);
CREATE FUNCTION guard_commission_attribution_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Attribution policies are append-only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW."actorId"
    AND u."tenantId" = NEW."tenantId" AND NOT u.disabled AND u."globalRole" IN ('MANAGER','SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'Attribution policies require an enabled salon manager';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commission_attribution_policy_guard BEFORE INSERT OR UPDATE OR DELETE
  ON commission_attribution_policies FOR EACH ROW EXECUTE FUNCTION guard_commission_attribution_policy();