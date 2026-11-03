-- The audit log is tenant data (NFR-SEC-1) and append-only (FR-NOT-4): no UPDATE,
-- on top of the DELETE the app role never has.
SELECT app_enable_tenant_rls('public.audit_events'::regclass);
--> statement-breakpoint
REVOKE UPDATE ON audit_events FROM comprobify_erp_app;
