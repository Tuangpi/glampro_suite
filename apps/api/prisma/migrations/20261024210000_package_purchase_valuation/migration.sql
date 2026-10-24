BEGIN;

-- Deliberately no activation or legacy backfill. Billing/display currency is not
-- purchase evidence. An authorized activation must supply the currency explicitly.
CREATE TABLE "package_valuation_activations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "policyVersion" INTEGER NOT NULL CHECK ("policyVersion" = 1),
  "currency" TEXT NOT NULL CHECK ("currency" ~ '^[A-Z]{3}$'),
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT NOT NULL CHECK (length(trim("actorId")) > 0),
  "reason" TEXT NOT NULL CHECK (length(trim("reason")) BETWEEN 1 AND 2000)
);
CREATE UNIQUE INDEX "package_valuation_activations_tenantId_key" ON "package_valuation_activations"("tenantId");
CREATE UNIQUE INDEX "package_valuation_activations_tenantId_id_key" ON "package_valuation_activations"("tenantId", "id");

CREATE TABLE "package_purchase_snapshots" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "activationId" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL CHECK ("policyVersion" = 1),
  "currency" TEXT NOT NULL CHECK ("currency" ~ '^[A-Z]{3}$'),
  "holdingId" TEXT NOT NULL CHECK (length(trim("holdingId")) > 0),
  "saleId" TEXT NOT NULL CHECK (length(trim("saleId")) > 0),
  "saleLineId" TEXT NOT NULL CHECK (length(trim("saleLineId")) > 0),
  "originalCustomerId" TEXT NOT NULL CHECK (length(trim("originalCustomerId")) > 0),
  "grantedSessions" INTEGER NOT NULL CHECK ("grantedSessions" > 0),
  "netCents" BIGINT NOT NULL CHECK ("netCents" >= 0),
  "taxCents" BIGINT NOT NULL CHECK ("taxCents" >= 0),
  "grossCents" BIGINT NOT NULL CHECK ("grossCents" >= 0 AND "grossCents"::numeric = "netCents"::numeric + "taxCents"::numeric),
  "originalExpiresAt" TIMESTAMP(3),
  "purchasedAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT NOT NULL CHECK (length(trim("actorId")) > 0),
  FOREIGN KEY ("tenantId", "activationId") REFERENCES "package_valuation_activations"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "package_purchase_snapshots_tenantId_id_key" ON "package_purchase_snapshots"("tenantId", "id");
CREATE UNIQUE INDEX "package_purchase_snapshots_tenantId_holdingId_key" ON "package_purchase_snapshots"("tenantId", "holdingId");
CREATE UNIQUE INDEX "package_purchase_snapshots_tenantId_saleLineId_key" ON "package_purchase_snapshots"("tenantId", "saleLineId");
CREATE INDEX "package_purchase_snapshots_tenantId_purchasedAt_id_idx" ON "package_purchase_snapshots"("tenantId", "purchasedAt", "id");

CREATE FUNCTION protect_package_valuation_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Package valuation evidence is append-only';
END;
$$;
CREATE TRIGGER package_valuation_activation_immutable BEFORE UPDATE OR DELETE ON "package_valuation_activations"
  FOR EACH ROW EXECUTE FUNCTION protect_package_valuation_evidence();
CREATE TRIGGER package_purchase_snapshot_immutable BEFORE UPDATE OR DELETE ON "package_purchase_snapshots"
  FOR EACH ROW EXECUTE FUNCTION protect_package_valuation_evidence();

-- Cross-row policy and currency provenance are enforced even for raw SQL writers.
-- purchasedAt is the original sale time and may be backdated operationally;
-- recordedAt is the activation-boundary evidence, not a fabricated historical close.
CREATE FUNCTION validate_package_purchase_activation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE activation "package_valuation_activations"%ROWTYPE;
BEGIN
  SELECT * INTO activation FROM "package_valuation_activations"
    WHERE "tenantId" = NEW."tenantId" AND id = NEW."activationId";
  IF NOT FOUND OR activation."policyVersion" <> NEW."policyVersion"
     OR activation.currency <> NEW.currency OR NEW."recordedAt" < activation."activatedAt" THEN
    RAISE EXCEPTION 'Package purchase snapshot must match its tenant activation, currency, policy and recording boundary';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER package_purchase_activation_evidence BEFORE INSERT ON "package_purchase_snapshots"
  FOR EACH ROW EXECUTE FUNCTION validate_package_purchase_activation();

COMMIT;