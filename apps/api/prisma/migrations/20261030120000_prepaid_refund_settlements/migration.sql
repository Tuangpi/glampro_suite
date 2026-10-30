BEGIN;
CREATE TABLE prepaid_refund_settlements (
  id TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "sourceKey" TEXT NOT NULL,
  "holdingId" TEXT NOT NULL,
  "itemType" TEXT NOT NULL CHECK ("itemType" IN ('PACKAGE', 'VALUE_PACKAGE')),
  "saleId" TEXT NOT NULL,
  "saleLineId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL CHECK ("actorRole" IN ('SUPER_ADMIN', 'MANAGER')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 3),
  reference TEXT NOT NULL CHECK (length(btrim(reference)) BETWEEN 3 AND 128),
  "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  currency TEXT NOT NULL CHECK (currency = 'SGD'),
  "payoutMethod" TEXT NOT NULL CHECK ("payoutMethod" IN ('NONE', 'CASH', 'CARD', 'PAYNOW', 'NETS', 'BANK_TRANSFER')),
  "netCents" BIGINT NOT NULL CHECK ("netCents" >= 0),
  "taxCents" BIGINT NOT NULL CHECK ("taxCents" >= 0),
  "grossCents" BIGINT NOT NULL CHECK ("grossCents" = "netCents" + "taxCents"),
  "cancelledGrossCents" BIGINT NOT NULL CHECK ("cancelledGrossCents" >= 0),
  "occurredAt" TIMESTAMP(3) NOT NULL,
  evidence JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("grossCents" = 0) = ("payoutMethod" = 'NONE')),
  UNIQUE ("tenantId", "sourceKey"),
  UNIQUE ("tenantId", "itemType", "holdingId")
);
CREATE INDEX prepaid_refund_settlements_month_idx ON prepaid_refund_settlements("tenantId", "occurredAt", id);
CREATE INDEX prepaid_refund_settlements_sale_idx ON prepaid_refund_settlements("tenantId", "saleId");
CREATE FUNCTION protect_prepaid_refund_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Prepaid refund settlements are append-only';
END;
$$;
CREATE TRIGGER prepaid_refund_settlement_immutable BEFORE UPDATE OR DELETE ON prepaid_refund_settlements
  FOR EACH ROW EXECUTE FUNCTION protect_prepaid_refund_settlement();
COMMIT;