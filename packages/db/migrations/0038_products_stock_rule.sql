-- FR-INV-6: a product stops tracking stock only when no warehouse holds or reserves any of
-- it, or its levels would be orphaned. Raised here so no path can skip it (mistake 29).
CREATE FUNCTION public.app_products_keep_stock() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tracks_stock AND NOT NEW.tracks_stock AND EXISTS (
    SELECT 1 FROM stock_levels
    WHERE tenant_id = NEW.tenant_id AND product_id = NEW.id AND (on_hand <> 0 OR reserved <> 0)
  ) THEN
    RAISE EXCEPTION 'STOCK_HELD: product % still holds stock', NEW.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_keep_stock BEFORE UPDATE OF tracks_stock ON products
  FOR EACH ROW EXECUTE FUNCTION app_products_keep_stock();
