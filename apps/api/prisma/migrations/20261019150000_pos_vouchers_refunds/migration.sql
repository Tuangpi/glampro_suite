-- POS upgrades: manager vouchers (V1/D1), loyalty allocation (L2) and recorded
-- full-sale refunds (R1/A1). Purely additive: no existing column or row is rewritten.

-- CreateEnum
CREATE TYPE "VoucherDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- AlterTable
ALTER TABLE "sales"
  ADD COLUMN "voucherCode" TEXT,
  ADD COLUMN "voucherDiscountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sale_lines"
  ADD COLUMN "voucherDiscountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "vouchers" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "discountType" "VoucherDiscountType" NOT NULL,
  "value" DECIMAL(12,2) NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "minSpend" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "maxRedemptions" INTEGER,
  "redeemedCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_redemptions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revertedAt" TIMESTAMP(3),

  CONSTRAINT "voucher_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_refunds" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "restocked" BOOLEAN NOT NULL,
  "refundedById" TEXT,
  "refundedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sale_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_tenantId_code_key" ON "vouchers"("tenantId", "code");
CREATE INDEX "vouchers_tenantId_startsAt_endsAt_idx" ON "vouchers"("tenantId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_redemptions_saleId_key" ON "voucher_redemptions"("saleId");
CREATE INDEX "voucher_redemptions_tenantId_voucherId_idx" ON "voucher_redemptions"("tenantId", "voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_refunds_saleId_key" ON "sale_refunds"("saleId");
CREATE INDEX "sale_refunds_tenantId_refundedAt_idx" ON "sale_refunds"("tenantId", "refundedAt");

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_refundedById_fkey" FOREIGN KEY ("refundedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
