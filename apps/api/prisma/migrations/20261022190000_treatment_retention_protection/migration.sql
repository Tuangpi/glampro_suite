-- No expiry period, purge, or erasure authorization is introduced.
ALTER TABLE "customers"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedById" TEXT,
  ADD COLUMN "archiveReason" TEXT;

ALTER TABLE "treatment_records"
  ADD COLUMN "retentionReviewAt" TIMESTAMP(3),
  ADD COLUMN "retentionReason" TEXT,
  ADD COLUMN "retentionReviewedAt" TIMESTAMP(3),
  ADD COLUMN "retentionReviewedById" TEXT,
  ADD COLUMN "retentionHold" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "retentionHoldReason" TEXT,
  ADD CONSTRAINT "treatment_retention_hold_reason_check"
    CHECK (NOT "retentionHold" OR length(trim("retentionHoldReason")) > 0 AND "retentionHoldReason" IS NOT NULL);

-- Restrict all parent paths, including tenant/customer cascades and form deletion.
ALTER TABLE "treatment_consent_events" DROP CONSTRAINT "treatment_consent_events_tenantId_fkey";
ALTER TABLE "treatment_consent_events" ADD CONSTRAINT "treatment_consent_events_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "treatment_consent_events" DROP CONSTRAINT "treatment_consent_events_treatmentRecordId_fkey";
ALTER TABLE "treatment_consent_events" ADD CONSTRAINT "treatment_consent_events_treatmentRecordId_fkey"
  FOREIGN KEY ("treatmentRecordId") REFERENCES "treatment_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "treatment_consent_events" DROP CONSTRAINT "treatment_consent_events_treatmentConsentFormId_fkey";
ALTER TABLE "treatment_consent_events" ADD CONSTRAINT "treatment_consent_events_treatmentConsentFormId_fkey"
  FOREIGN KEY ("treatmentConsentFormId") REFERENCES "treatment_consent_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "treatment_consent_events" DROP CONSTRAINT "treatment_consent_events_customerId_fkey";
ALTER TABLE "treatment_consent_events" ADD CONSTRAINT "treatment_consent_events_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A hold protects even records without consent, including parent cascades.
CREATE FUNCTION protect_treatment_retention_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."retentionHold" THEN
    RAISE EXCEPTION 'Treatment has an active retention hold' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER treatment_retention_hold_delete
  BEFORE DELETE ON "treatment_records"
  FOR EACH ROW EXECUTE FUNCTION protect_treatment_retention_hold();