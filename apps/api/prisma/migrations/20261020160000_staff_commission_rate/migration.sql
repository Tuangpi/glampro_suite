ALTER TABLE "users" ADD COLUMN "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD CONSTRAINT "users_commission_rate_range"
  CHECK ("commissionRate" >= 0 AND "commissionRate" <= 100);