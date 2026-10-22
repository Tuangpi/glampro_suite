-- Persist the family-sharing fields already declared in schema.prisma.
-- Nullable additions preserve existing catalogue, customer and holding rows.
BEGIN;

ALTER TABLE "customer_value_package_holdings"
ADD COLUMN "familyId" TEXT,
ADD COLUMN "updatedBy" TEXT;

ALTER TABLE "customers" ADD COLUMN "familyId" TEXT;

ALTER TABLE "packages" ADD COLUMN "familyId" TEXT;

ALTER TABLE "products" ADD COLUMN "familyId" TEXT;

CREATE INDEX "customer_value_package_holdings_familyId_idx"
ON "customer_value_package_holdings"("familyId");

COMMIT;