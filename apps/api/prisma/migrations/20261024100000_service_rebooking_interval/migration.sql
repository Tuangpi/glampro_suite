-- The earlier interval scaffold was never migrated. Preserve explicit values if
-- a development database already has the column; new/legacy rows inherit company policy.
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "interval" INTEGER;
ALTER TABLE "services" ALTER COLUMN "interval" DROP NOT NULL;
ALTER TABLE "services" ALTER COLUMN "interval" DROP DEFAULT;
ALTER TABLE "services" ADD CONSTRAINT "services_rebooking_interval_check"
  CHECK ("interval" IS NULL OR "interval" BETWEEN 1 AND 365);