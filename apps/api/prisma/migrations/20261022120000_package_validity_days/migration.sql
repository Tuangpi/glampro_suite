-- Existing catalogue entries and holdings retain their no-expiry behavior.
ALTER TABLE "packages" ADD COLUMN "validityDays" INTEGER;
ALTER TABLE "value_packages" ADD COLUMN "validityDays" INTEGER;

ALTER TABLE "packages" ADD CONSTRAINT "packages_validityDays_check"
  CHECK ("validityDays" IS NULL OR "validityDays" BETWEEN 1 AND 36500);
ALTER TABLE "value_packages" ADD CONSTRAINT "value_packages_validityDays_check"
  CHECK ("validityDays" IS NULL OR "validityDays" BETWEEN 1 AND 36500);