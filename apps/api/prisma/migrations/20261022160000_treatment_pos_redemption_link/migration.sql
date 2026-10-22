-- Historical quantities remain unlinked; no balance changes or backfill.
ALTER TABLE "treatment_records" ADD COLUMN "packageRedemptionId" TEXT;
CREATE UNIQUE INDEX "treatment_records_packageRedemptionId_key"
  ON "treatment_records"("packageRedemptionId");
ALTER TABLE "treatment_records" ADD CONSTRAINT "treatment_records_packageRedemptionId_fkey"
  FOREIGN KEY ("packageRedemptionId") REFERENCES "customer_redemptions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;