-- FR-NOT-1, FR-NOT-2 (ADR-036): notifications, who sees them, and what each member turned off.
-- Foreign keys over rows under forced RLS need system context (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_one_per_choice" UNIQUE("tenant_id","user_id","type","channel"),
	CONSTRAINT "notification_preferences_type_check" CHECK (type IN ('RENEWAL_DUE', 'GRACE_STARTED', 'PAST_DUE', 'MOVED_TO_FREE', 'PAYMENT_REPRICED', 'RENEWAL_REPRICED', 'PAYMENT_VERIFIED', 'PAYMENT_REJECTED')),
	CONSTRAINT "notification_preferences_channel_check" CHECK (channel IN ('IN_APP', 'EMAIL'))
);
--> statement-breakpoint
CREATE TABLE "notification_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_receipts_one_per_user" UNIQUE("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link" text NOT NULL,
	"environment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "notifications_type_check" CHECK (type IN ('RENEWAL_DUE', 'GRACE_STARTED', 'PAST_DUE', 'MOVED_TO_FREE', 'PAYMENT_REPRICED', 'RENEWAL_REPRICED', 'PAYMENT_VERIFIED', 'PAYMENT_REJECTED')),
	CONSTRAINT "notifications_environment_check" CHECK (environment IN ('TEST', 'PRODUCTION'))
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_notification_fk" FOREIGN KEY ("tenant_id","notification_id") REFERENCES "public"."notifications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_receipts_user_recent" ON "notification_receipts" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_receipts_user_unread" ON "notification_receipts" USING btree ("tenant_id","user_id") WHERE read_at IS NULL;--> statement-breakpoint
SELECT app_enable_tenant_rls('public.notifications'::regclass);--> statement-breakpoint
SELECT app_enable_tenant_rls('public.notification_receipts'::regclass);--> statement-breakpoint
SELECT app_enable_tenant_rls('public.notification_preferences'::regclass);--> statement-breakpoint
CREATE TRIGGER notification_preferences_touch_updated_at BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
