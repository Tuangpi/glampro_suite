-- Availability is optional. Existing products and their stock stay tenant-wide.
ALTER TABLE "products" ADD COLUMN "outletId" TEXT;
CREATE INDEX "products_tenantId_outletId_idx" ON "products"("tenantId", "outletId");
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_outletId_fkey"
  FOREIGN KEY ("tenantId", "outletId") REFERENCES "outlets"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;