-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "depositAmount" INTEGER,
ADD COLUMN     "noShowFee" INTEGER,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "onlineBookingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onlineDepositAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "onlineNoShowFee" INTEGER NOT NULL DEFAULT 0;
