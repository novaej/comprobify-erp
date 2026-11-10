-- FR-BILL-5, FR-PLAN-1a (ADR-030): seats, changes due at the period end, and add-ons bought by
-- the company. Foreign keys and checks over rows under forced RLS need system context (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_check";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_purpose_check";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_target_check";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_rejected_check";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "target_module_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "extra_seats" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_interval" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_seats" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_target_module_id_modules_id_fk" FOREIGN KEY ("target_module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_plan_fk" FOREIGN KEY ("pending_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_check" CHECK (action IN ('organization.created', 'organization.went_live', 'organization.two_factor_requirement_changed', 'organization.settings_changed', 'branch.created', 'branch.updated', 'issue_point.created', 'issue_point.document_types_changed', 'issue_point.paused_changed', 'sequence.starting_set', 'certificate.uploaded', 'member.invited', 'member.invitation_revoked', 'member.joined', 'member.role_changed', 'member.removed', 'member.issue_points_changed', 'agreements.accepted', 'session.started', 'subscription.plan_changed', 'subscription.billing_changed', 'subscription.price_changed', 'subscription.module_added', 'subscription.module_removed', 'subscription.limit_set', 'subscription.limit_cleared', 'entitlements.override_set', 'entitlements.override_cleared', 'payment.created', 'payment.reported', 'payment.cancelled', 'payment.verified', 'payment.rejected', 'payment.refunded', 'subscription.change_scheduled', 'subscription.cancelled', 'subscription.resumed'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_purpose_check" CHECK (purpose IN ('INITIAL', 'RENEWAL', 'TIER_CHANGE', 'SEAT_CHANGE', 'DOCUMENT_PACK', 'ADD_ON'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_target_check" CHECK (CASE purpose
            WHEN 'INITIAL' THEN target_plan_id IS NOT NULL AND target_interval IS NOT NULL
            WHEN 'TIER_CHANGE' THEN target_plan_id IS NOT NULL AND target_interval IS NOT NULL
            WHEN 'SEAT_CHANGE' THEN target_seats IS NOT NULL AND target_seats >= 0
            WHEN 'DOCUMENT_PACK' THEN pack_size > 0
            WHEN 'ADD_ON' THEN target_module_id IS NOT NULL
            ELSE true
          END);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_rejected_check" CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_seats_check" CHECK (extra_seats >= 0 AND (pending_seats IS NULL OR pending_seats >= 0));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_interval_check" CHECK (pending_interval IS NULL OR pending_interval IN ('MONTHLY', 'YEARLY'));--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
