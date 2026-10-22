-- RenameIndex
-- On a fresh database the index is created by 20261021120000 instead.
-- Keep the rename for databases where the treatment tables already existed.
ALTER INDEX IF EXISTS "treatment_consent_events_treatmentRecordId_treatmentConsentForm" RENAME TO "treatment_consent_events_treatmentRecordId_treatmentConsent_key";
