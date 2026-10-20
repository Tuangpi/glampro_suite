-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "customerConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "messageRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "messaging_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderHours" INTEGER NOT NULL DEFAULT 24,
    "rebookingDays" INTEGER NOT NULL DEFAULT 28,
    "quietStart" INTEGER NOT NULL DEFAULT 20,
    "quietEnd" INTEGER NOT NULL DEFAULT 9,
    "cancellationHours" INTEGER NOT NULL DEFAULT 2,
    "consentVersion" TEXT NOT NULL DEFAULT '',
    "serviceConsentText" TEXT NOT NULL DEFAULT '',
    "marketingConsentText" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "messaging_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_consents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "service" BOOLEAN NOT NULL DEFAULT false,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "channel_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_consent_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "service" BOOLEAN NOT NULL,
    "marketing" BOOLEAN NOT NULL,
    "preferred" BOOLEAN NOT NULL,
    "revision" INTEGER NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "serviceText" TEXT NOT NULL,
    "marketingText" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "appointmentId" TEXT,
    "saleId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "channel" TEXT,
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "providerSid" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "messaging_settings_tenantId_key" ON "messaging_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_consents_tenantId_customerId_channel_key" ON "channel_consents"("tenantId", "customerId", "channel");

-- CreateIndex
CREATE INDEX "channel_consent_events_tenantId_customerId_createdAt_idx" ON "channel_consent_events"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_jobs_providerSid_key" ON "message_jobs"("providerSid");

-- CreateIndex
CREATE INDEX "message_jobs_status_dueAt_idx" ON "message_jobs"("status", "dueAt");

-- CreateIndex
CREATE INDEX "message_jobs_tenantId_createdAt_idx" ON "message_jobs"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "public_links_tokenHash_key" ON "public_links"("tokenHash");

-- CreateIndex
CREATE INDEX "public_links_tenantId_kind_targetId_idx" ON "public_links"("tenantId", "kind", "targetId");

-- AddForeignKey
ALTER TABLE "messaging_settings" ADD CONSTRAINT "messaging_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_consents" ADD CONSTRAINT "channel_consents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_consent_events" ADD CONSTRAINT "channel_consent_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_jobs" ADD CONSTRAINT "message_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_links" ADD CONSTRAINT "public_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

