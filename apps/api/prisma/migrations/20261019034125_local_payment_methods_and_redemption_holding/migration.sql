-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'PAYNOW_SGQR';
ALTER TYPE "PaymentMethod" ADD VALUE 'NETS';
ALTER TYPE "PaymentMethod" ADD VALUE 'GRABPAY';
ALTER TYPE "PaymentMethod" ADD VALUE 'ATOME';
ALTER TYPE "PaymentMethod" ADD VALUE 'PACKAGE';
ALTER TYPE "PaymentMethod" ADD VALUE 'PREPAID_CREDIT';

-- AlterTable
ALTER TABLE "customer_redemptions" ADD COLUMN     "holdingId" TEXT;

-- CreateIndex
CREATE INDEX "customer_redemptions_tenantId_holdingId_idx" ON "customer_redemptions"("tenantId", "holdingId");
