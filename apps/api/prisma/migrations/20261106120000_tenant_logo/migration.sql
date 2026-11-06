-- The salon's logo (see `TenantLogo` in schema.prisma).
--
-- `tenantId` is the primary key, so the table holds at most one image per salon and
-- a re-upload replaces the previous one rather than leaving orphans behind.
CREATE TABLE "tenant_logos" (
  "tenantId" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_logos_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "tenant_logos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
