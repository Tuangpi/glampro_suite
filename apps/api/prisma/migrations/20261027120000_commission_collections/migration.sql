-- Evidence only. No inferred historical allocations and no earnings activation.
CREATE TABLE commission_collections (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "eventKey" TEXT NOT NULL CHECK (length("eventKey") BETWEEN 8 AND 128),
  "eventHash" TEXT NOT NULL CHECK ("eventHash" ~ '^[a-f0-9]{64}$'),
  "sourceType" TEXT NOT NULL CHECK ("sourceType" IN ('SALE_PAYMENT', 'OUTSTANDING_PAYMENT')),
  "sourceId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  "grossCents" BIGINT NOT NULL CHECK ("grossCents" > 0),
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "actorId" TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "commission_collections_tenantId_eventKey_key"
  ON commission_collections("tenantId", "eventKey");
CREATE UNIQUE INDEX "commission_collections_tenantId_sourceType_sourceId_key"
  ON commission_collections("tenantId", "sourceType", "sourceId");
CREATE INDEX "commission_collections_tenantId_saleId_idx"
  ON commission_collections("tenantId", "saleId");

CREATE TABLE commission_collection_allocations (
  id TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "collectionId" TEXT NOT NULL REFERENCES commission_collections(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "saleLineId" TEXT NOT NULL,
  "grossCents" BIGINT NOT NULL CHECK ("grossCents" > 0),
  "netCents" BIGINT NOT NULL CHECK ("netCents" >= 0),
  "taxCents" BIGINT NOT NULL CHECK ("taxCents" >= 0),
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  CHECK ("grossCents" = "netCents" + "taxCents")
);
CREATE UNIQUE INDEX "commission_collection_allocations_tenantId_collectionId_saleLineId_key"
  ON commission_collection_allocations("tenantId", "collectionId", "saleLineId");
CREATE INDEX "commission_collection_allocations_tenantId_saleLineId_idx"
  ON commission_collection_allocations("tenantId", "saleLineId");

CREATE FUNCTION guard_commission_collection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Collection evidence is append-only'; END IF;
  -- Serialize both direct inserts and application callers with POS before configuration.
  PERFORM pg_advisory_xact_lock(hashtextextended('prepaid:' || NEW."tenantId", 0));
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW."actorId" AND "tenantId" = NEW."tenantId" AND NOT disabled)
    OR NOT EXISTS (SELECT 1 FROM sales WHERE id = NEW."saleId" AND "tenantId" = NEW."tenantId" AND status = 'COMPLETED')
    OR EXISTS (SELECT 1 FROM sale_refunds WHERE "saleId" = NEW."saleId") THEN
    RAISE EXCEPTION 'Collection requires a current actor and completed unrefunded salon sale';
  END IF;
  IF NEW."sourceType" = 'SALE_PAYMENT' THEN
    IF NOT EXISTS (SELECT 1 FROM sale_payments WHERE id = NEW."sourceId"
      AND "tenantId" = NEW."tenantId" AND "saleId" = NEW."saleId"
      AND method NOT IN ('PACKAGE', 'PREPAID_CREDIT') AND "sessionId" IS NULL
      AND amount * 100 = NEW."grossCents" AND "createdAt" = NEW."occurredAt") THEN
      RAISE EXCEPTION 'Collection payment source mismatch or unsupported settlement';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM customer_outstanding_payments p
      JOIN customer_outstandings o ON o.id = p."outstandingId"
      JOIN sales s ON s.id = p."saleId"
      WHERE p.id = NEW."sourceId" AND p."tenantId" = NEW."tenantId"
      AND p."saleId" = NEW."saleId" AND o."tenantId" = NEW."tenantId"
      AND o."saleId" = p."saleId" AND o."customerId" = p."customerId"
      AND s."customerId" = p."customerId" AND p."paidAmount" * 100 = NEW."grossCents"
      AND p."paidAt" = NEW."occurredAt") THEN
      RAISE EXCEPTION 'Outstanding collection source mismatch';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM commission_collections WHERE "tenantId" = NEW."tenantId"
    AND "saleId" = NEW."saleId" AND currency <> NEW.currency) THEN
    RAISE EXCEPTION 'Collection currency differs from original evidence';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commission_collection_guard BEFORE INSERT OR UPDATE OR DELETE
  ON commission_collections FOR EACH ROW EXECUTE FUNCTION guard_commission_collection();

CREATE FUNCTION guard_commission_collection_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source commission_collections%ROWTYPE;
  line sale_lines%ROWTYPE;
  prior_gross BIGINT;
  prior_tax BIGINT;
  line_gross BIGINT;
  line_tax BIGINT;
  expected_tax BIGINT;
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Collection allocations are append-only'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('prepaid:' || NEW."tenantId", 0));
  SELECT * INTO source FROM commission_collections WHERE id = NEW."collectionId" AND "tenantId" = NEW."tenantId";
  SELECT * INTO line FROM sale_lines WHERE id = NEW."saleLineId" AND "tenantId" = NEW."tenantId" AND "saleId" = source."saleId";
  IF source.id IS NULL OR line.id IS NULL THEN RAISE EXCEPTION 'Allocation source or line tenant mismatch'; END IF;
  line_gross := (line."lineTotal" - line."voucherDiscountAmount") * 100;
  line_tax := line."taxAmount" * 100;
  SELECT COALESCE(SUM("grossCents"), 0), COALESCE(SUM("taxCents"), 0) INTO prior_gross, prior_tax
    FROM commission_collection_allocations WHERE "tenantId" = NEW."tenantId" AND "saleLineId" = NEW."saleLineId";
  IF line_gross <= 0 OR line_tax < 0 OR line_tax > line_gross OR prior_gross + NEW."grossCents" > line_gross THEN
    RAISE EXCEPTION 'Allocation exceeds contracted line consideration';
  END IF;
  expected_tax := floor(((prior_gross + NEW."grossCents")::numeric * line_tax * 2 + line_gross) / (line_gross::numeric * 2)) - prior_tax;
  IF NEW."taxCents" <> expected_tax THEN RAISE EXCEPTION 'Allocation tax is not the exact cumulative delta'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commission_collection_allocation_guard BEFORE INSERT OR UPDATE OR DELETE
  ON commission_collection_allocations FOR EACH ROW EXECUTE FUNCTION guard_commission_collection_allocation();

CREATE FUNCTION reconcile_commission_collection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'commission_collections' THEN
    source_id := NEW.id;
  ELSE
    source_id := NEW."collectionId";
  END IF;
  IF EXISTS (SELECT 1 FROM commission_collections c WHERE c.id = source_id AND c."grossCents" <>
    (SELECT COALESCE(SUM(a."grossCents"), 0) FROM commission_collection_allocations a WHERE a."collectionId" = c.id)) THEN
    RAISE EXCEPTION 'Collection allocations must reconcile to the settled source';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER commission_collection_reconciles AFTER INSERT ON commission_collections
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_commission_collection();
CREATE CONSTRAINT TRIGGER commission_collection_allocation_reconciles AFTER INSERT ON commission_collection_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_commission_collection();