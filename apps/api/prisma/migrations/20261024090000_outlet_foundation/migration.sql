-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "outletId" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "outletId" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "outletId" TEXT;

-- CreateTable
CREATE TABLE "outlets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "address" TEXT,
    "phone" TEXT,
    "time_zone" TEXT NOT NULL DEFAULT 'Asia/Singapore',
    "locale" TEXT NOT NULL DEFAULT 'en-SG',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outlets_tenantId_idx" ON "outlets"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "outlets_tenantId_id_key" ON "outlets"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "outlets_tenantId_slug_key" ON "outlets"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "packages_tenantId_outletId_idx" ON "packages"("tenantId", "outletId");

-- CreateIndex
CREATE INDEX "customers_tenantId_outletId_idx" ON "customers"("tenantId", "outletId");

-- CreateIndex
CREATE INDEX "sales_tenantId_outletId_idx" ON "sales"("tenantId", "outletId");

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_tenantId_outletId_fkey" FOREIGN KEY ("tenantId", "outletId") REFERENCES "outlets"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_outletId_fkey" FOREIGN KEY ("tenantId", "outletId") REFERENCES "outlets"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenantId_outletId_fkey" FOREIGN KEY ("tenantId", "outletId") REFERENCES "outlets"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
