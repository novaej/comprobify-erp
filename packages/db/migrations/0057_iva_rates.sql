-- FR-BILL-2 (ADR-034): the IVA on subscriptions, with its history, in place of IVA_RATE. Adding
-- checks over rows under forced RLS needs system context (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "iva_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"effective_on" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" uuid,
	CONSTRAINT "iva_rates_rate_check" CHECK (rate >= 0 AND rate < 100),
	CONSTRAINT "iva_rates_withdrawn_check" CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL))
);
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_check";--> statement-breakpoint
ALTER TABLE "platform_audit_events" DROP CONSTRAINT "platform_audit_events_action_check";--> statement-breakpoint
ALTER TABLE "iva_rates" ADD CONSTRAINT "iva_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iva_rates" ADD CONSTRAINT "iva_rates_withdrawn_by_users_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "iva_rates_effective_on_unique" ON "iva_rates" USING btree ("effective_on") WHERE withdrawn_at IS NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_check" CHECK (action IN ('organization.created', 'organization.went_live', 'organization.two_factor_requirement_changed', 'organization.settings_changed', 'branch.created', 'branch.updated', 'issue_point.created', 'issue_point.document_types_changed', 'issue_point.paused_changed', 'sequence.starting_set', 'certificate.uploaded', 'member.invited', 'member.invitation_revoked', 'member.joined', 'member.role_changed', 'member.removed', 'member.issue_points_changed', 'agreements.accepted', 'session.started', 'subscription.plan_changed', 'subscription.billing_changed', 'subscription.price_changed', 'subscription.module_added', 'subscription.module_removed', 'subscription.limit_set', 'subscription.limit_cleared', 'entitlements.override_set', 'entitlements.override_cleared', 'payment.created', 'payment.reported', 'payment.cancelled', 'payment.verified', 'payment.rejected', 'payment.refunded', 'subscription.change_scheduled', 'subscription.cancelled', 'subscription.resumed', 'organization.suspended', 'organization.reactivated', 'subscription.renewal_due', 'subscription.grace_started', 'subscription.past_due', 'subscription.moved_to_free', 'payment.card_duplicate', 'payment.invoiced', 'payment.card_resolved', 'payment.repriced'));--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_action_check" CHECK (action IN ('module.created', 'module.updated', 'module.feature_added', 'module.feature_removed', 'plan.created', 'plan.updated', 'plan.module_added', 'plan.module_removed', 'plan.limit_changed', 'price.drafted', 'price.published', 'price.discarded', 'iva.scheduled', 'iva.withdrawn'));--> statement-breakpoint
SELECT app_protect_platform_table('public.iva_rates'::regclass);--> statement-breakpoint
-- A rate is history: once recorded, only its withdrawal is ever written, and only once.
CREATE FUNCTION public.app_iva_rate_frozen() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.withdrawn_at IS NOT NULL OR NEW.rate IS DISTINCT FROM OLD.rate
     OR NEW.effective_on IS DISTINCT FROM OLD.effective_on THEN
    RAISE EXCEPTION 'An IVA rate can not change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER iva_rate_frozen BEFORE UPDATE ON iva_rates
  FOR EACH ROW EXECUTE FUNCTION app_iva_rate_frozen();--> statement-breakpoint
-- Ecuador's general rate since 1 April 2024, what IVA_RATE defaulted to.
INSERT INTO iva_rates (rate, effective_on) VALUES (15.00, '2024-04-01');--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
