-- Twin reset (PRD glossary, ADR-043): the one exception to "no hard deletes". The audit CHECK is
-- re-added over a table with rows, which Postgres validates with a query: system context (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_check";--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_check" CHECK (action IN ('organization.created', 'organization.went_live', 'organization.twin_reset', 'organization.two_factor_requirement_changed', 'organization.settings_changed', 'branch.created', 'branch.updated', 'issue_point.created', 'issue_point.document_types_changed', 'issue_point.paused_changed', 'sequence.starting_set', 'certificate.uploaded', 'member.invited', 'member.invitation_revoked', 'member.joined', 'member.role_changed', 'member.removed', 'member.issue_points_changed', 'agreements.accepted', 'session.started', 'subscription.plan_changed', 'subscription.billing_changed', 'subscription.price_changed', 'subscription.module_added', 'subscription.module_removed', 'subscription.limit_set', 'subscription.limit_cleared', 'entitlements.override_set', 'entitlements.override_cleared', 'payment.created', 'payment.reported', 'payment.cancelled', 'payment.verified', 'payment.rejected', 'payment.refunded', 'subscription.change_scheduled', 'subscription.cancelled', 'subscription.resumed', 'organization.suspended', 'organization.reactivated', 'subscription.renewal_due', 'subscription.grace_started', 'subscription.past_due', 'subscription.moved_to_free', 'payment.card_duplicate', 'payment.invoiced', 'payment.invoice_waived', 'payment.card_resolved', 'payment.repriced', 'subscription.custom_billing_started', 'subscription.moved_to_custom', 'subscription.module_complimentary', 'document.voided', 'stock.adjusted', 'stock.opening_set', 'stock.opening_imported', 'product.created', 'product.updated', 'product.active_changed', 'product.imported', 'client.created', 'client.updated', 'client.active_changed', 'client.imported', 'provider.created', 'provider.updated', 'provider.active_changed', 'purchase_order.cancelled', 'sale_order.cancelled', 'sale_order.invoiced', 'receivable.payment_recorded', 'receivable.payment_voided', 'bulk.batch_started', 'data.exported'));--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);--> statement-breakpoint
-- Empties a test copy of what it did and what it holds. Owned by the owner role, which may delete;
-- the app role may only call it, in system context, for a tenant in TEST mode with a real company.
-- Kept: the tenant, its members and their restrictions, branches, issue points and their document
-- types, warehouses (mirrors of the real company's), the certificate, logo, plan, notices and the
-- activity log. Counters start again at 1. Core copies the master data back in the same transaction.
CREATE FUNCTION public.app_reset_twin(p_tenant uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  twin record;
BEGIN
  IF NOT public.app_is_system() THEN
    RAISE EXCEPTION 'app_reset_twin needs system context' USING ERRCODE = '42501';
  END IF;
  SELECT mode, twin_of INTO twin FROM tenants WHERE id = p_tenant FOR UPDATE;
  IF NOT FOUND OR twin.mode <> 'TEST' OR twin.twin_of IS NULL THEN
    RAISE EXCEPTION 'app_reset_twin only resets a test copy' USING ERRCODE = '42501';
  END IF;
  -- Children first, as the foreign keys require.
  DELETE FROM bulk_batch_items WHERE tenant_id = p_tenant;
  DELETE FROM bulk_batches WHERE tenant_id = p_tenant;
  DELETE FROM sale_order_invoice_lines WHERE tenant_id = p_tenant;
  DELETE FROM invoice_payments WHERE tenant_id = p_tenant;
  DELETE FROM document_events WHERE tenant_id = p_tenant;
  DELETE FROM document_lines WHERE tenant_id = p_tenant;
  DELETE FROM document_payments WHERE tenant_id = p_tenant;
  DELETE FROM document_reissues WHERE tenant_id = p_tenant;
  DELETE FROM document_versions WHERE tenant_id = p_tenant;
  DELETE FROM sri_exchanges WHERE tenant_id = p_tenant;
  DELETE FROM purchase_receipt_lines WHERE tenant_id = p_tenant;
  DELETE FROM purchase_receipts WHERE tenant_id = p_tenant;
  DELETE FROM purchase_order_lines WHERE tenant_id = p_tenant;
  DELETE FROM purchase_orders WHERE tenant_id = p_tenant;
  DELETE FROM sale_order_lines WHERE tenant_id = p_tenant;
  DELETE FROM sale_orders WHERE tenant_id = p_tenant;
  DELETE FROM documents WHERE tenant_id = p_tenant;
  DELETE FROM stock_movements WHERE tenant_id = p_tenant;
  DELETE FROM stock_levels WHERE tenant_id = p_tenant;
  DELETE FROM document_templates WHERE tenant_id = p_tenant;
  DELETE FROM products WHERE tenant_id = p_tenant;
  DELETE FROM clients WHERE tenant_id = p_tenant;
  DELETE FROM providers WHERE tenant_id = p_tenant;
  DELETE FROM tenant_counters WHERE tenant_id = p_tenant;
  -- Every sequence back to 1 (the column default), for each type an issue point ever had.
  DELETE FROM document_sequences WHERE tenant_id = p_tenant;
  INSERT INTO document_sequences (tenant_id, issue_point_id, document_type)
    SELECT tenant_id, issue_point_id, document_type
    FROM issue_point_document_types WHERE tenant_id = p_tenant;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_reset_twin(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_reset_twin(uuid) TO comprobify_app;
