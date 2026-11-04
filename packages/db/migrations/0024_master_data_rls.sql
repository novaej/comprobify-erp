-- Clients and products are tenant data (NFR-SEC-1); the twin keeps its own.
SELECT app_enable_tenant_rls('public.clients'::regclass);
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.products'::regclass);
