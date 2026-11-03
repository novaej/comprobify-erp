-- The platform's own activity log (ADR-011): written only in system context, append-only.
SELECT app_protect_platform_table('public.platform_audit_events'::regclass);
--> statement-breakpoint
REVOKE UPDATE ON platform_audit_events FROM comprobify_erp_app;
