BEGIN;
CREATE TABLE "package_valuation_states" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "purchaseId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "availableOrdinals" JSONB NOT NULL CHECK (jsonb_typeof("availableOrdinals") = 'array'),
  "expired" BOOLEAN NOT NULL DEFAULT false,
  "voided" BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY ("tenantId", "purchaseId") REFERENCES package_purchase_snapshots("tenantId", id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "package_valuation_states_tenantId_purchaseId_key" ON package_valuation_states("tenantId", "purchaseId");

CREATE TABLE "package_valuation_movements" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "purchaseId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL CHECK (length(trim("sourceKey")) > 0),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('GRANT','REDEEM','RESTORE','TRANSFER_OUT','TRANSFER_IN','EXPIRE_OUT','EXPIRE_IN','PURCHASE_VOID')),
  "bucket" TEXT NOT NULL CHECK ("bucket" IN ('ACTIVE','EXPIRED')),
  "quantity" INTEGER NOT NULL,
  "netCents" BIGINT NOT NULL,
  "taxCents" BIGINT NOT NULL,
  "grossCents" BIGINT NOT NULL CHECK ("grossCents"::numeric = "netCents"::numeric + "taxCents"::numeric),
  "ordinals" JSONB NOT NULL CHECK (jsonb_typeof("ordinals") = 'array'),
  "actorId" TEXT,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("tenantId", "purchaseId") REFERENCES package_purchase_snapshots("tenantId", id) ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (("kind" IN ('GRANT','RESTORE','TRANSFER_IN','EXPIRE_IN') AND "quantity" >= 0 AND "netCents" >= 0 AND "taxCents" >= 0)
    OR ("kind" IN ('REDEEM','TRANSFER_OUT','EXPIRE_OUT','PURCHASE_VOID') AND "quantity" <= 0 AND "netCents" <= 0 AND "taxCents" <= 0)),
  CHECK (("kind" IN ('EXPIRE_OUT','EXPIRE_IN') AND "actorId" IS NULL)
    OR ("kind" NOT IN ('EXPIRE_OUT','EXPIRE_IN') AND length(trim("actorId")) > 0 AND "actorId" IS NOT NULL)),
  CHECK ("kind" <> 'EXPIRE_OUT' OR bucket = 'ACTIVE'),
  CHECK ("kind" <> 'EXPIRE_IN' OR bucket = 'EXPIRED')
);
CREATE UNIQUE INDEX "package_valuation_movements_tenantId_purchaseId_sourceKey_key" ON package_valuation_movements("tenantId", "purchaseId", "sourceKey");
CREATE INDEX "package_valuation_movements_tenantId_effectiveAt_id_idx" ON package_valuation_movements("tenantId", "effectiveAt", id);
CREATE TRIGGER package_valuation_movement_immutable BEFORE UPDATE OR DELETE ON package_valuation_movements
  FOR EACH ROW EXECUTE FUNCTION protect_package_valuation_evidence();
COMMIT;