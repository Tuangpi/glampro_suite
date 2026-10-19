-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "consentRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pdpaConsent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "privacy_notices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dataConsentText" TEXT NOT NULL,
    "marketingConsentText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "privacy_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consent_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "pdpaConsent" BOOLEAN NOT NULL,
    "marketingOptIn" BOOLEAN NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "noticeId" TEXT,

    CONSTRAINT "customer_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "privacy_notices_tenantId_createdAt_idx" ON "privacy_notices"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_notices_tenantId_version_key" ON "privacy_notices"("tenantId", "version");

-- CreateIndex
CREATE INDEX "customer_consent_events_tenantId_customerId_idx" ON "customer_consent_events"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_consent_events_customerId_revision_key" ON "customer_consent_events"("customerId", "revision");

-- AddForeignKey
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consent_events" ADD CONSTRAINT "customer_consent_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consent_events" ADD CONSTRAINT "customer_consent_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consent_events" ADD CONSTRAINT "customer_consent_events_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "privacy_notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

