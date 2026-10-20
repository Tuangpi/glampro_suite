-- Rooms and equipment (TK2610-0020 phase D).
--
-- A booking already occupies a person per line (phase B). This adds the other
-- half of "one party per window": the room or the machine a line is performed on.
-- Rooms and equipment share one table because the occupancy rule is the same —
-- three identical chairs are three rows, so "is one free" is an overlap question,
-- not capacity arithmetic.
CREATE TYPE "ResourceKind" AS ENUM ('ROOM', 'EQUIPMENT');

CREATE TABLE "resources" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "ResourceKind" NOT NULL DEFAULT 'ROOM',
  "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- The desk's picker must not offer two rooms with one name; the same name in
-- another salon is a different room and stays allowed.
CREATE UNIQUE INDEX "resources_tenantId_name_key" ON "resources"("tenantId", "name");
CREATE INDEX "resources_tenantId_kind_idx" ON "resources"("tenantId", "kind");

ALTER TABLE "resources" ADD CONSTRAINT "resources_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which resources a service **may** use. An eligibility list, like
-- `staff_departments`: a line takes one member of the set that is free, not all
-- of them. A service with no rows here is booked without a resource check.
CREATE TABLE "service_resources" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,

  CONSTRAINT "service_resources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_resources_serviceId_resourceId_key"
  ON "service_resources"("serviceId", "resourceId");
CREATE INDEX "service_resources_tenantId_resourceId_idx"
  ON "service_resources"("tenantId", "resourceId");

ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable: every line that already exists holds no resource, which is the truth
-- for bookings taken before the salon described its rooms.
ALTER TABLE "appointment_lines" ADD COLUMN "resourceId" TEXT;

CREATE INDEX "appointment_lines_tenantId_resourceId_startsAt_idx"
  ON "appointment_lines"("tenantId", "resourceId", "startsAt");

-- `SET NULL`: deleting a room must not delete the bookings taken in it. The line
-- keeps its window and simply stops naming a resource.
ALTER TABLE "appointment_lines" ADD CONSTRAINT "appointment_lines_resourceId_fkey"
  FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
