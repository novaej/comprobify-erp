-- FR-ADM-5: the operator's retry of a failed job joins the platform log. The CHECK is re-added over
-- a table with rows, which Postgres validates with a query: system context (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
ALTER TABLE "platform_audit_events" DROP CONSTRAINT "platform_audit_events_action_check";--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_action_check" CHECK (action IN ('module.created', 'module.updated', 'module.feature_added', 'module.feature_removed', 'plan.created', 'plan.updated', 'plan.module_added', 'plan.module_removed', 'plan.limit_changed', 'price.drafted', 'price.published', 'price.discarded', 'iva.scheduled', 'iva.withdrawn', 'job.retried', 'email_template.drafted', 'email_template.published', 'email_template.discarded', 'email_template.test_sent'));--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
