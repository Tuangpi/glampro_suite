CREATE TABLE "direct_staff_tips" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
  "staffId" TEXT NOT NULL,
  "staffName" TEXT NOT NULL,
  "recordedById" TEXT NOT NULL,
  "recordedByName" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "returnedAt" TIMESTAMP(3),
  "returnedById" TEXT,
  "returnedByName" TEXT,
  "returnReason" TEXT,
  CONSTRAINT "direct_staff_tips_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "direct_staff_tips_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "direct_staff_tips_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "direct_staff_tips_tenantId_idempotencyKey_key" ON "direct_staff_tips"("tenantId", "idempotencyKey");
CREATE INDEX "direct_staff_tips_tenantId_saleId_recordedAt_idx" ON "direct_staff_tips"("tenantId", "saleId", "recordedAt");