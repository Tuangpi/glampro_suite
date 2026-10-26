-- Explicit choices only: never backfill a seller/performer from the cashier.
ALTER TABLE sale_lines ADD COLUMN attribution JSONB;

CREATE FUNCTION guard_sale_line_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.attribution IS DISTINCT FROM OLD.attribution AND EXISTS (
    SELECT 1 FROM sales WHERE id = OLD."saleId" AND status <> 'HELD'
  ) THEN
    RAISE EXCEPTION 'Completed sale attribution requires an append-only correction';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sale_line_attribution_immutable BEFORE UPDATE ON sale_lines
  FOR EACH ROW EXECUTE FUNCTION guard_sale_line_attribution();