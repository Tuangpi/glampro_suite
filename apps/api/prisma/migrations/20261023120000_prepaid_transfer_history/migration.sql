BEGIN;
CREATE TABLE "prepaid_transfer_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "holdingId" TEXT NOT NULL,
  "fromCustomerId" TEXT NOT NULL,
  "toCustomerId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
  "expiresAt" TIMESTAMP(3),
  "reason" TEXT NOT NULL CHECK (length(trim("reason")) BETWEEN 1 AND 2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("fromCustomerId" <> "toCustomerId")
);
CREATE INDEX "prepaid_transfer_events_tenantId_holdingId_idx" ON "prepaid_transfer_events"("tenantId", "holdingId");
CREATE INDEX "prepaid_transfer_events_tenantId_fromCustomerId_createdAt_id_idx" ON "prepaid_transfer_events"("tenantId", "fromCustomerId", "createdAt", "id");
CREATE INDEX "prepaid_transfer_events_tenantId_toCustomerId_createdAt_id_idx" ON "prepaid_transfer_events"("tenantId", "toCustomerId", "createdAt", "id");

CREATE FUNCTION protect_prepaid_transfer_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Preserve ordinary evidence. Allow only the parent tenant's FK cascade.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Prepaid transfer history is append-only';
END;
$$;
CREATE TRIGGER prepaid_transfer_event_immutable BEFORE UPDATE OR DELETE ON "prepaid_transfer_events"
  FOR EACH ROW EXECUTE FUNCTION protect_prepaid_transfer_event();
COMMIT;