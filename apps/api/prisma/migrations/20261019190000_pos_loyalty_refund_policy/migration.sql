-- Additive policy snapshots. Historical awards and refund records are unchanged.
ALTER TABLE "sale_lines"
  ADD COLUMN "loyaltyBasePoints" INTEGER,
  ADD COLUMN "loyaltyOriginalAmount" DECIMAL(12,2),
  ADD COLUMN "loyaltyNetAmount" DECIMAL(12,2),
  ADD COLUMN "loyaltyAwardedPoints" INTEGER;
ALTER TABLE "sale_refunds" ADD COLUMN "payouts" JSONB;
ALTER TABLE "employee_performances" ADD COLUMN "refundAdjustment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "employee_commissions"
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "refundAdjustment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false;