ALTER TABLE "outlets" ADD COLUMN "operating_hours" JSONB;
ALTER TABLE "appointments" ADD COLUMN "outletId" TEXT;
CREATE INDEX "appointments_tenantId_outletId_startsAt_idx"
  ON "appointments"("tenantId", "outletId", "startsAt");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_outletId_fkey"
  FOREIGN KEY ("tenantId", "outletId") REFERENCES "outlets"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;