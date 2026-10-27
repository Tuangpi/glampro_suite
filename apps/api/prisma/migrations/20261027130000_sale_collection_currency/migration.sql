-- No historical currency inference. Current checkout explicitly confirms SGD.
ALTER TABLE sales ADD COLUMN "collectionCurrency" TEXT;
ALTER TABLE sales ADD CONSTRAINT sales_collection_currency_check
  CHECK ("collectionCurrency" IS NULL OR "collectionCurrency" = 'SGD');

CREATE FUNCTION guard_sale_collection_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."collectionCurrency" IS NOT NULL AND NEW."collectionCurrency" IS DISTINCT FROM OLD."collectionCurrency" THEN
    RAISE EXCEPTION 'Confirmed sale collection currency is immutable';
  END IF;
  IF OLD.status <> 'HELD' AND NEW."collectionCurrency" IS DISTINCT FROM OLD."collectionCurrency" THEN
    RAISE EXCEPTION 'Historical sale currency cannot be inferred';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sale_collection_currency_guard BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION guard_sale_collection_currency();