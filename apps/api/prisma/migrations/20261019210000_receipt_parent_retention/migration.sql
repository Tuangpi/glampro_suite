-- Preserve receipts and ordered lines when customer/cashier/performer deletion is attempted.
-- No rows are deleted or rewritten. Normal account archival remains available.
ALTER TABLE "sales" DROP CONSTRAINT "sales_customerId_fkey";
ALTER TABLE "sales" ADD CONSTRAINT "sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" DROP CONSTRAINT "sales_staffId_fkey";
ALTER TABLE "sales" ADD CONSTRAINT "sales_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_staffId_fkey";
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
