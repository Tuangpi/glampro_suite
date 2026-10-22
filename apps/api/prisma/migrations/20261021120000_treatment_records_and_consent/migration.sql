-- CreateEnum
CREATE TYPE "TreatmentStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TreatmentPhotoType" AS ENUM ('BEFORE', 'AFTER');

-- CreateTable
CREATE TABLE "treatment_records" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "appointmentId" TEXT,
  "staffId" TEXT,
  "serviceId" TEXT,
  "packageHoldingId" TEXT,
  "treatmentType" TEXT NOT NULL,
  "status" "TreatmentStatus" NOT NULL DEFAULT 'SCHEDULED',
  "notes" TEXT,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "quantityConsumed" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "treatment_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treatment_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "treatment_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "treatment_records_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "treatment_records_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "treatment_records_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "treatment_records_packageHoldingId_fkey" FOREIGN KEY ("packageHoldingId") REFERENCES "customer_package_holdings"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "treatment_photos" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "treatmentRecordId" TEXT NOT NULL,
  "customerPhotoId" TEXT NOT NULL,
  "photoType" "TreatmentPhotoType" NOT NULL,
  "caption" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "treatment_photos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treatment_photos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "treatment_photos_treatmentRecordId_fkey" FOREIGN KEY ("treatmentRecordId") REFERENCES "treatment_records"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "treatment_photos_customerPhotoId_fkey" FOREIGN KEY ("customerPhotoId") REFERENCES "customer_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "treatment_consent_forms" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "treatmentType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "treatment_consent_forms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treatment_consent_forms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "treatment_consent_events" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "treatmentRecordId" TEXT NOT NULL,
  "treatmentConsentFormId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "consented" BOOLEAN NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consentedById" TEXT NOT NULL,
  "signatureData" BYTEA,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "treatment_consent_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treatment_consent_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "treatment_consent_events_treatmentRecordId_fkey" FOREIGN KEY ("treatmentRecordId") REFERENCES "treatment_records"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "treatment_consent_events_treatmentConsentFormId_fkey" FOREIGN KEY ("treatmentConsentFormId") REFERENCES "treatment_consent_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "treatment_consent_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "treatment_records_tenantId_idx" ON "treatment_records"("tenantId");

-- CreateIndex
CREATE INDEX "treatment_records_customerId_idx" ON "treatment_records"("customerId");

-- CreateIndex
CREATE INDEX "treatment_records_tenantId_status_idx" ON "treatment_records"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "treatment_photos_treatmentRecordId_photoType_key" ON "treatment_photos"("treatmentRecordId", "photoType");

-- CreateIndex
CREATE INDEX "treatment_photos_tenantId_idx" ON "treatment_photos"("tenantId");

-- CreateIndex
CREATE INDEX "treatment_photos_treatmentRecordId_idx" ON "treatment_photos"("treatmentRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "treatment_consent_forms_tenantId_treatmentType_version_key" ON "treatment_consent_forms"("tenantId", "treatmentType", "version");

-- CreateIndex
CREATE INDEX "treatment_consent_forms_tenantId_idx" ON "treatment_consent_forms"("tenantId");

-- CreateIndex
CREATE INDEX "treatment_consent_forms_tenantId_treatmentType_isActive_idx" ON "treatment_consent_forms"("tenantId", "treatmentType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "treatment_consent_events_treatmentRecordId_treatmentConsent_key" ON "treatment_consent_events"("treatmentRecordId", "treatmentConsentFormId");

-- CreateIndex
CREATE INDEX "treatment_consent_events_tenantId_idx" ON "treatment_consent_events"("tenantId");

-- CreateIndex
CREATE INDEX "treatment_consent_events_customerId_idx" ON "treatment_consent_events"("customerId");