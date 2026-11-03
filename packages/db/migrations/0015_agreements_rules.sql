-- Templates are platform data published by the migrate step; the app only reads them.
REVOKE INSERT, UPDATE ON agreement_templates FROM comprobify_erp_app;
--> statement-breakpoint
-- Acceptances are tenant data (NFR-SEC-1) and legal evidence: append-only.
SELECT app_enable_tenant_rls('public.agreement_acceptances'::regclass);
--> statement-breakpoint
REVOKE UPDATE ON agreement_acceptances FROM comprobify_erp_app;
