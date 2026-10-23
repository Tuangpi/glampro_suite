BEGIN;
CREATE TABLE prepaid_families (
  id TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", id)
);
CREATE TABLE prepaid_family_members (
  id TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "familyId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", "customerId"),
  FOREIGN KEY ("tenantId", "familyId") REFERENCES prepaid_families("tenantId", id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX prepaid_family_members_tenantId_familyId_idx ON prepaid_family_members("tenantId", "familyId");
CREATE TABLE prepaid_family_events (
  id TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "customerId" TEXT NOT NULL,
  "fromFamilyId" TEXT,
  "toFamilyId" TEXT,
  "actorId" TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("fromFamilyId" IS DISTINCT FROM "toFamilyId")
);
CREATE INDEX prepaid_family_events_tenantId_customerId_createdAt_id_idx ON prepaid_family_events("tenantId", "customerId", "createdAt", id);
CREATE FUNCTION protect_prepaid_family_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Prepaid family history is append-only';
END;
$$;
CREATE TRIGGER prepaid_family_event_immutable BEFORE UPDATE OR DELETE ON prepaid_family_events
  FOR EACH ROW EXECUTE FUNCTION protect_prepaid_family_event();
COMMIT;