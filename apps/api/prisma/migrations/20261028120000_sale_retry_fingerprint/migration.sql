ALTER TABLE sales ADD COLUMN "requestHash" TEXT;
CREATE FUNCTION protect_sale_request_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."requestHash" IS DISTINCT FROM OLD."requestHash" THEN
    RAISE EXCEPTION 'Original sale request fingerprint cannot be changed or backfilled';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sale_request_hash_immutable BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION protect_sale_request_hash();