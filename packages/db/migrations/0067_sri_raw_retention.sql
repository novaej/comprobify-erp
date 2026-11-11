-- FR-DOC-13 (retention): what SRI answered stays as history, but its raw copy is a technical
-- duplicate kept 90 days. The app role may now update that one column, and a trigger lets it only
-- be cleared, so nothing else about an exchange can change. The CHECK is re-added over a table
-- with rows: system context (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
ALTER TABLE "platform_audit_events" DROP CONSTRAINT "platform_audit_events_action_check";--> statement-breakpoint
CREATE INDEX "sri_exchanges_raw_idx" ON "sri_exchanges" USING btree ("occurred_at") WHERE raw IS NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_action_check" CHECK (action IN ('module.created', 'module.updated', 'module.feature_added', 'module.feature_removed', 'plan.created', 'plan.updated', 'plan.module_added', 'plan.module_removed', 'plan.limit_changed', 'price.drafted', 'price.published', 'price.discarded', 'iva.scheduled', 'iva.withdrawn', 'document.exchanges_viewed', 'job.retried', 'email_template.drafted', 'email_template.published', 'email_template.discarded', 'email_template.test_sent'));
--> statement-breakpoint
GRANT UPDATE (raw) ON sri_exchanges TO comprobify_erp_app;--> statement-breakpoint
CREATE FUNCTION public.app_sri_exchange_raw_clear_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.raw IS NOT NULL THEN
    RAISE EXCEPTION 'An SRI exchange''s raw answer can only be cleared' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER sri_exchange_raw_clear_only BEFORE UPDATE ON sri_exchanges
  FOR EACH ROW EXECUTE FUNCTION app_sri_exchange_raw_clear_only();--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
