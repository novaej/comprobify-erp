-- RLS for certificates and logos (NFR-SEC-1).
SELECT app_enable_tenant_rls('public.certificates'::regclass);
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.tenant_logos'::regclass);
--> statement-breakpoint
CREATE TRIGGER certificates_touch_updated_at BEFORE UPDATE ON certificates
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER tenant_logos_touch_updated_at BEFORE UPDATE ON tenant_logos
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
