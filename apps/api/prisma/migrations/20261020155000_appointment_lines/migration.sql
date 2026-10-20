-- A booking's services, in the order they happen (TK2610-0020 phase B).
--
-- Before this migration a booking was exactly one service: `appointments.serviceId`
-- plus a snapshotted duration. A line carries its own window and performer so a
-- booking can be a chain of services, possibly by different people.
CREATE TABLE "appointment_lines" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "staffId" TEXT,
  "position" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER NOT NULL,

  CONSTRAINT "appointment_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_lines_window_check" CHECK (
    "endsAt" > "startsAt" AND "durationMinutes" > 0 AND "position" >= 0
  )
);

CREATE UNIQUE INDEX "appointment_lines_appointmentId_position_key"
  ON "appointment_lines"("appointmentId", "position");

CREATE INDEX "appointment_lines_tenantId_staffId_startsAt_idx"
  ON "appointment_lines"("tenantId", "staffId", "startsAt");

ALTER TABLE "appointment_lines" ADD CONSTRAINT "appointment_lines_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_lines" ADD CONSTRAINT "appointment_lines_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_lines" ADD CONSTRAINT "appointment_lines_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_lines" ADD CONSTRAINT "appointment_lines_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill one line per existing booking: its service, its performer, and the
-- window it already holds. The id is derived from the appointment so the backfill
-- is deterministic and a re-run collides instead of duplicating.
INSERT INTO "appointment_lines" (
  "id", "tenantId", "appointmentId", "serviceId", "staffId",
  "position", "startsAt", "endsAt", "durationMinutes"
)
SELECT
  'al_' || md5(a."id"),
  a."tenantId",
  a."id",
  a."serviceId",
  a."staffId",
  0,
  a."startsAt",
  a."endsAt",
  COALESCE(
    a."durationMinutes",
    GREATEST(1, ROUND(EXTRACT(EPOCH FROM (a."endsAt" - a."startsAt")) / 60))::int
  )
FROM "appointments" a
WHERE a."serviceId" IS NOT NULL;
