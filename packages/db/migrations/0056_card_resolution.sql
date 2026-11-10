-- FR-BILL-4, FR-ADM-2: card charges the operator settled by hand, and the activity log's events
-- for them and for the operator's invoices. Checks over rows under forced RLS need system context
-- (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_check";--> statement-breakpoint
ALTER TABLE "payphone_transactions" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payphone_transactions" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "payphone_transactions" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "payphone_transactions" ADD CONSTRAINT "payphone_transactions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_check" CHECK (action IN ('organization.created', 'organization.went_live', 'organization.two_factor_requirement_changed', 'organization.settings_changed', 'branch.created', 'branch.updated', 'issue_point.created', 'issue_point.document_types_changed', 'issue_point.paused_changed', 'sequence.starting_set', 'certificate.uploaded', 'member.invited', 'member.invitation_revoked', 'member.joined', 'member.role_changed', 'member.removed', 'member.issue_points_changed', 'agreements.accepted', 'session.started', 'subscription.plan_changed', 'subscription.billing_changed', 'subscription.price_changed', 'subscription.module_added', 'subscription.module_removed', 'subscription.limit_set', 'subscription.limit_cleared', 'entitlements.override_set', 'entitlements.override_cleared', 'payment.created', 'payment.reported', 'payment.cancelled', 'payment.verified', 'payment.rejected', 'payment.refunded', 'subscription.change_scheduled', 'subscription.cancelled', 'subscription.resumed', 'organization.suspended', 'organization.reactivated', 'subscription.renewal_due', 'subscription.grace_started', 'subscription.past_due', 'subscription.moved_to_free', 'payment.card_duplicate', 'payment.invoiced', 'payment.card_resolved'));--> statement-breakpoint
ALTER TABLE "payphone_transactions" ADD CONSTRAINT "payphone_transactions_resolved_check" CHECK ((resolved_at IS NULL) = (resolution_note IS NULL)
          AND (resolved_at IS NULL OR status IN ('DUPLICATE', 'ERROR')));--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
