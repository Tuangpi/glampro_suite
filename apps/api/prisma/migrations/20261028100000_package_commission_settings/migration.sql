-- Explicit prospective configuration only; never infer settings for existing packages.
ALTER TABLE packages ADD COLUMN "commissionSettings" JSONB;
ALTER TABLE packages ADD CONSTRAINT package_commission_settings_object_check
  CHECK ("commissionSettings" IS NULL OR jsonb_typeof("commissionSettings") = 'object');