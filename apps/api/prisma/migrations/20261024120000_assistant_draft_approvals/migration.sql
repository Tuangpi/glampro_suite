CREATE TABLE "assistant_drafts" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "customerId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'SMS' CHECK ("channel" = 'SMS'),
  "destination" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sender" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'APPROVED', 'QUEUED')),
  "approvedById" TEXT,
  "approvedTokenVersion" INTEGER,
  "queuedById" TEXT,
  "queuedTokenVersion" INTEGER,
  "reviewDueAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "assistant_drafts_tenantId_createdAt_idx" ON "assistant_drafts"("tenantId", "createdAt");
CREATE TABLE "assistant_draft_events" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "draftId" TEXT NOT NULL REFERENCES "assistant_drafts"("id") ON DELETE RESTRICT,
  "actorId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "assistant_draft_events_tenantId_draftId_createdAt_idx" ON "assistant_draft_events"("tenantId", "draftId", "createdAt");
ALTER TABLE "message_jobs" ADD COLUMN "assistantDraftId" TEXT;
CREATE UNIQUE INDEX "message_jobs_assistantDraftId_key" ON "message_jobs"("assistantDraftId");
ALTER TABLE "message_jobs" ADD CONSTRAINT "message_jobs_assistantDraftId_fkey"
  FOREIGN KEY ("assistantDraftId") REFERENCES "assistant_drafts"("id") ON DELETE RESTRICT;
CREATE FUNCTION protect_assistant_draft_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Assistant draft evidence is append-only';
END;
$$;
CREATE TRIGGER assistant_draft_event_immutable BEFORE UPDATE OR DELETE ON "assistant_draft_events"
  FOR EACH ROW EXECUTE FUNCTION protect_assistant_draft_event();