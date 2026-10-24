BEGIN;
CREATE TABLE "session_package_transfer_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "holdingId" TEXT NOT NULL,
  "fromCustomerId" TEXT NOT NULL,
  "toCustomerId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "expiresAt" TIMESTAMP(3),
  "reason" TEXT NOT NULL CHECK (length(trim("reason")) BETWEEN 1 AND 2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("fromCustomerId" <> "toCustomerId")
);
CREATE INDEX "session_package_transfer_events_tenantId_holdingId_idx" ON "session_package_transfer_events"("tenantId", "holdingId");
CREATE INDEX "session_transfer_from_history_idx" ON "session_package_transfer_events"("tenantId", "fromCustomerId", "createdAt", "id");
CREATE INDEX "session_transfer_to_history_idx" ON "session_package_transfer_events"("tenantId", "toCustomerId", "createdAt", "id");

CREATE FUNCTION protect_session_package_transfer_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Session package transfer history is append-only';
END;
$$;
CREATE TRIGGER session_package_transfer_event_immutable BEFORE UPDATE OR DELETE ON "session_package_transfer_events"
  FOR EACH ROW EXECUTE FUNCTION protect_session_package_transfer_event();
COMMIT;