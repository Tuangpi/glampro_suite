BEGIN;
ALTER TABLE customer_value_package_holdings ADD COLUMN "sharedFamilyId" TEXT;
ALTER TABLE customer_value_package_holdings ADD CONSTRAINT prepaid_shared_family_fk
  FOREIGN KEY ("tenantId", "sharedFamilyId") REFERENCES prepaid_families("tenantId", id) ON UPDATE CASCADE;
CREATE TABLE prepaid_balance_events (
  id TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "holdingId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "previousCustomerId" TEXT,
  "actorId" TEXT,
  "saleId" TEXT,
  kind TEXT NOT NULL,
  "amountBefore" DECIMAL(12,2) NOT NULL,
  "amountAfter" DECIMAL(12,2) NOT NULL,
  delta DECIMAL(12,2) NOT NULL,
  "sharedFamilyId" TEXT,
  "previousSharedFamilyId" TEXT,
  "expiresAt" TIMESTAMP(3),
  reason TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (delta = "amountAfter" - "amountBefore")
);
CREATE INDEX prepaid_balance_events_tenantId_customerId_createdAt_id_idx ON prepaid_balance_events("tenantId", "customerId", "createdAt", id);
CREATE INDEX prepaid_balance_events_tenantId_holdingId_createdAt_id_idx ON prepaid_balance_events("tenantId", "holdingId", "createdAt", id);
-- Opening snapshots are not fabricated historical purchases or known historical actors.
INSERT INTO prepaid_balance_events(id, "tenantId", "holdingId", "customerId", kind,
  "amountBefore", "amountAfter", delta, "expiresAt", reason)
SELECT gen_random_uuid()::text, "tenantId", id, "customerId", 'OPENING',
  "amountRemaining", "amountRemaining", 0, "expiresAt", 'Opening snapshot; earlier activity is not reconstructed'
FROM customer_value_package_holdings;
CREATE FUNCTION record_prepaid_balance_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  h customer_value_package_holdings;
  before_amount DECIMAL(12,2) := 0;
  after_amount DECIMAL(12,2) := 0;
  old_customer TEXT;
  old_family TEXT;
  event_kind TEXT;
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND NEW."amountRemaining" = OLD."amountRemaining"
    AND NEW."customerId" = OLD."customerId" AND NEW."sharedFamilyId" IS NOT DISTINCT FROM OLD."sharedFamilyId"
    AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt" THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN h := OLD; ELSE h := NEW; after_amount := NEW."amountRemaining"; END IF;
  IF TG_OP <> 'INSERT' THEN before_amount := OLD."amountRemaining"; old_customer := OLD."customerId"; old_family := OLD."sharedFamilyId"; END IF;
  IF TG_OP = 'INSERT' THEN event_kind := 'GRANT';
  ELSIF TG_OP = 'DELETE' THEN event_kind := 'REMOVAL';
  ELSIF NEW."customerId" <> OLD."customerId" THEN event_kind := 'TRANSFER';
  ELSIF NEW."sharedFamilyId" IS DISTINCT FROM OLD."sharedFamilyId" THEN event_kind := 'SHARING';
  ELSIF after_amount < before_amount THEN event_kind := 'SPEND';
  ELSIF after_amount > before_amount THEN event_kind := 'RESTORE';
  ELSE event_kind := 'EXPIRY_CHANGE'; END IF;
  INSERT INTO prepaid_balance_events(id, "tenantId", "holdingId", "customerId", "previousCustomerId", "actorId", "saleId",
    kind, "amountBefore", "amountAfter", delta, "sharedFamilyId", "previousSharedFamilyId", "expiresAt", reason)
  VALUES(gen_random_uuid()::text, h."tenantId", h.id, h."customerId", old_customer,
    nullif(current_setting('glampro.actor_id', true), ''), nullif(current_setting('glampro.sale_id', true), ''),
    event_kind, before_amount, after_amount, after_amount-before_amount, h."sharedFamilyId", old_family, h."expiresAt",
    nullif(current_setting('glampro.prepaid_reason', true), ''));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prepaid_balance_evidence AFTER INSERT OR UPDATE OR DELETE ON customer_value_package_holdings
  FOR EACH ROW EXECUTE FUNCTION record_prepaid_balance_event();
CREATE FUNCTION protect_prepaid_balance_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Prepaid balance history is append-only';
END;
$$;
CREATE TRIGGER prepaid_balance_event_immutable BEFORE UPDATE OR DELETE ON prepaid_balance_events
  FOR EACH ROW EXECUTE FUNCTION protect_prepaid_balance_event();
COMMIT;