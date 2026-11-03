-- Subscriptions, their items and overrides are tenant data (NFR-SEC-1, ADR-011).
SELECT app_enable_tenant_rls('public.subscriptions'::regclass);
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.subscription_items'::regclass);
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.tenant_feature_overrides'::regclass);
