-- Document types per issue point and their sequences are tenant data (NFR-SEC-1).
SELECT app_enable_tenant_rls('public.issue_point_document_types'::regclass);
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.document_sequences'::regclass);
--> statement-breakpoint
-- Every issue point so far issues facturas: the base module has DOC_TYPE_01 on every plan.
-- Reading RLS tables in a migration needs system context (CLAUDE.md mistake 20).
SELECT set_config('app.rls_system', 'on', true);
--> statement-breakpoint
INSERT INTO issue_point_document_types (tenant_id, issue_point_id, document_type)
SELECT tenant_id, id, '01' FROM issue_points
ON CONFLICT (issue_point_id, document_type) DO NOTHING;
--> statement-breakpoint
INSERT INTO document_sequences (tenant_id, issue_point_id, document_type)
SELECT tenant_id, id, '01' FROM issue_points
ON CONFLICT (issue_point_id, document_type) DO NOTHING;
--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
