-- Repeating bookings (TK2610-0020 phase C).
--
-- A series is the *rule* only: the anchor booking carries the time, the services
-- and the performers, and each occurrence is a normal appointment row that points
-- back here. Nothing is duplicated, so an occurrence edited on its own stays
-- edited instead of being rewritten by the series.
CREATE TABLE "appointment_series" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "intervalWeeks" INTEGER NOT NULL,
  "occurrences" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "appointment_series_pkey" PRIMARY KEY ("id"),
  -- The same bounds the contract enforces, so a row written straight to the
  -- table cannot describe a series the app would refuse to create.
  CONSTRAINT "appointment_series_rule_check" CHECK (
    "intervalWeeks" BETWEEN 1 AND 8 AND "occurrences" BETWEEN 2 AND 52
  )
);

CREATE INDEX "appointment_series_tenantId_createdAt_idx"
  ON "appointment_series"("tenantId", "createdAt");

ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable: every booking that already exists is a one-off, which is the truth.
ALTER TABLE "appointments" ADD COLUMN "seriesId" TEXT;
ALTER TABLE "appointments" ADD COLUMN "seriesIndex" INTEGER;

CREATE INDEX "appointments_seriesId_seriesIndex_idx"
  ON "appointments"("seriesId", "seriesIndex");

-- `SET NULL` rather than `CASCADE`: retiring the series rule must never take the
-- bookings it produced with it. A deleted series leaves ordinary appointments.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "appointment_series"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
