-- RLS for invitations and issue-point access (NFR-SEC-1).
SELECT app_enable_tenant_rls('public.invitations'::regclass);
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.issue_point_access'::regclass);
--> statement-breakpoint
CREATE TRIGGER invitations_touch_updated_at BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER issue_point_access_touch_updated_at BEFORE UPDATE ON issue_point_access
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
