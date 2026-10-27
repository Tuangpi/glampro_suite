BEGIN;
-- Configuration only: no tenant seed, earnings activation or historical backfill.
CREATE TABLE payroll_plans (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  positions TEXT[] NOT NULL,
  "outletIds" TEXT[] NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", id)
);
CREATE INDEX payroll_plans_tenant_idx ON payroll_plans("tenantId");
CREATE TABLE payroll_plan_versions (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "versionNo" INTEGER NOT NULL CHECK ("versionNo" > 0),
  "effectiveFrom" TEXT NOT NULL CHECK ("effectiveFrom" ~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$'),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  definition JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  CHECK ((status = 'PUBLISHED') = ("publishedAt" IS NOT NULL)),
  FOREIGN KEY ("tenantId", "planId") REFERENCES payroll_plans("tenantId", id) ON DELETE RESTRICT,
  UNIQUE ("tenantId", "planId", "versionNo")
);
CREATE INDEX payroll_plan_versions_effective_idx ON payroll_plan_versions("tenantId", "planId", "effectiveFrom");
CREATE UNIQUE INDEX payroll_plan_versions_publication_date_key ON payroll_plan_versions("tenantId", "planId", "effectiveFrom") WHERE status = 'PUBLISHED';
CREATE UNIQUE INDEX payroll_plan_versions_one_draft_key ON payroll_plan_versions("tenantId", "planId") WHERE status = 'DRAFT';
CREATE TABLE payroll_configuration_events (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('PLAN', 'ASSIGNMENT', 'STAFF', 'PROFILE', 'SETTINGS')),
  "targetId" TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  payload JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", kind, "targetId", revision)
);
CREATE INDEX payroll_configuration_events_target_idx ON payroll_configuration_events("tenantId", kind, "targetId");
CREATE FUNCTION protect_payroll_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'payroll_plan_versions' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'DRAFT' AND NEW.id = OLD.id AND NEW."tenantId" = OLD."tenantId"
         AND NEW."planId" = OLD."planId" AND NEW."versionNo" = OLD."versionNo" THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Published payroll versions and configuration audit events are immutable';
END;
$$;
CREATE TRIGGER payroll_versions_immutable BEFORE UPDATE OR DELETE ON payroll_plan_versions
  FOR EACH ROW EXECUTE FUNCTION protect_payroll_configuration();
CREATE TRIGGER payroll_events_immutable BEFORE UPDATE OR DELETE ON payroll_configuration_events
  FOR EACH ROW EXECUTE FUNCTION protect_payroll_configuration();
COMMIT;