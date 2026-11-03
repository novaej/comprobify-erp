CREATE TABLE "platform_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_audit_events_action_check" CHECK (action IN ('module.created', 'module.updated', 'module.feature_added', 'module.feature_removed', 'plan.created', 'plan.updated', 'plan.module_added', 'plan.module_removed', 'plan.limit_changed'))
);
--> statement-breakpoint
ALTER TABLE "plan_limits" ADD COLUMN "pending_value" integer;--> statement-breakpoint
ALTER TABLE "plan_limits" ADD COLUMN "pending_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_events_occurred_idx" ON "platform_audit_events" USING btree ("occurred_at");--> statement-breakpoint
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_pending_check" CHECK ((pending_from IS NULL) = (pending_value IS NULL) AND (pending_value IS NULL OR pending_value >= 0));