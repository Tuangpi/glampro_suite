BEGIN;
ALTER TABLE packages ADD COLUMN "redemptionMode" TEXT NOT NULL DEFAULT 'PER_UNIT',
  ADD COLUMN "serviceSet" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE packages ADD CONSTRAINT package_redemption_mode_check CHECK ("redemptionMode" IN ('PER_UNIT', 'SERVICE_SET'));
ALTER TABLE customer_package_holdings ADD COLUMN "redemptionRules" JSONB;
COMMIT;