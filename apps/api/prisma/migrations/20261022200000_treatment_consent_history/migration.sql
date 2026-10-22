ALTER TABLE treatment_consent_forms ADD COLUMN "signatureRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE treatment_consent_events ADD COLUMN "eventType" TEXT,
  ADD COLUMN "previousEventId" TEXT,
  ADD COLUMN "correctsEventId" TEXT,
  ADD COLUMN "reason" TEXT;
UPDATE treatment_consent_events SET "eventType" = CASE WHEN consented THEN 'GRANT' ELSE 'DECLINE' END;
ALTER TABLE treatment_consent_events ALTER COLUMN "eventType" SET NOT NULL;
DROP INDEX "treatment_consent_events_treatmentRecordId_treatmentConsent_key";
CREATE UNIQUE INDEX "treatment_consent_events_previousEventId_key" ON treatment_consent_events("previousEventId");
CREATE INDEX "treatment_consent_events_treatmentRecordId_treatmentConsentFormId_consentedAt_idx"
  ON treatment_consent_events("treatmentRecordId", "treatmentConsentFormId", "consentedAt");
ALTER TABLE treatment_consent_events ADD CONSTRAINT treatment_consent_event_type_check
  CHECK ("eventType" IN ('GRANT','DECLINE','WITHDRAWAL','RECONSENT','CORRECTION'));
ALTER TABLE treatment_consent_events ADD CONSTRAINT treatment_consent_correction_check
  CHECK (("eventType" = 'CORRECTION' AND "correctsEventId" IS NOT NULL AND length(trim(reason)) > 0)
    OR ("eventType" <> 'CORRECTION' AND "correctsEventId" IS NULL));
ALTER TABLE treatment_consent_events ADD CONSTRAINT treatment_consent_previous_fk
  FOREIGN KEY ("previousEventId") REFERENCES treatment_consent_events(id) ON DELETE RESTRICT;
ALTER TABLE treatment_consent_events ADD CONSTRAINT treatment_consent_corrects_fk
  FOREIGN KEY ("correctsEventId") REFERENCES treatment_consent_events(id) ON DELETE RESTRICT;

-- Corrections are new events. Normal writes cannot rewrite earlier evidence.
CREATE FUNCTION protect_treatment_consent_event_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Treatment consent evidence is immutable; append an annotation instead';
END;
$$;
CREATE TRIGGER treatment_consent_event_immutable BEFORE UPDATE ON treatment_consent_events
  FOR EACH ROW EXECUTE FUNCTION protect_treatment_consent_event_update();

CREATE FUNCTION protect_treatment_consent_form_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW."tenantId", NEW."treatmentType", NEW.title, NEW.content, NEW.version,
      NEW."signatureRequired", NEW."createdAt") IS DISTINCT FROM
     ROW(OLD.id, OLD."tenantId", OLD."treatmentType", OLD.title, OLD.content, OLD.version,
      OLD."signatureRequired", OLD."createdAt") THEN
    RAISE EXCEPTION 'Publish a new treatment consent form version instead';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER treatment_consent_form_immutable BEFORE UPDATE ON treatment_consent_forms
  FOR EACH ROW EXECUTE FUNCTION protect_treatment_consent_form_version();