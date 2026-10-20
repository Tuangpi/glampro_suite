-- Nullable, tenant-scoped unique barcode on products.
--
-- NULL means "this product carries no barcode". Postgres treats NULLs as
-- distinct inside a unique index, so products without a barcode are not
-- constrained by this index and any number of them may coexist per tenant.
--
-- The tenant is part of the key on purpose: a barcode identifies a product
-- within one salon, and two salons may use the same barcode for their own
-- products. The partial index below is an optimisation for the scanner's
-- exact-match lookup; the unique constraint itself covers every row.
ALTER TABLE "products" ADD COLUMN "barcode" TEXT;

CREATE UNIQUE INDEX "products_tenantId_barcode_key" ON "products" ("tenantId", "barcode");
