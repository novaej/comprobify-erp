-- Turning two-factor off deletes the row, as ADR-009 anticipated. Credentials, not records.
GRANT DELETE ON two_factors TO comprobify_erp_app;
--> statement-breakpoint
CREATE TRIGGER two_factors_touch_updated_at BEFORE UPDATE ON two_factors
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
