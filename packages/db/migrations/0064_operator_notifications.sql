-- Notices for the platform's operators (ADR-036): their tables, written only in system context,
-- and the two email templates. The foreign key to users and the template CHECK are validated with
-- a query over tables with rows: system context (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "platform_notification_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_notification_receipts_one_per_user" UNIQUE("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "platform_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link" text NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_notifications_type_check" CHECK (type IN ('PAYMENT_REPORTED', 'CARD_PAYMENT_APPLIED'))
);
--> statement-breakpoint
ALTER TABLE "email_templates" DROP CONSTRAINT "email_templates_template_check";--> statement-breakpoint
ALTER TABLE "platform_notification_receipts" ADD CONSTRAINT "platform_notification_receipts_notification_id_platform_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."platform_notifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_notification_receipts" ADD CONSTRAINT "platform_notification_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_notification_receipts_user_recent" ON "platform_notification_receipts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_notification_receipts_user_unread" ON "platform_notification_receipts" USING btree ("user_id") WHERE read_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_notifications_dedupe_unique" ON "platform_notifications" USING btree ("dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "platform_notifications_recent" ON "platform_notifications" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_template_check" CHECK (template IN ('verifyEmail', 'resetPassword', 'invitation', 'renewalDue', 'graceStarted', 'pastDue', 'movedToFree', 'paymentRepriced', 'renewalRepriced', 'paymentVerified', 'paymentRejected', 'documentRejected', 'documentSendFailed', 'documentOverdue', 'batchCompleted', 'certificateExpiring', 'certificateExpired', 'quotaNearing', 'quotaReached', 'priceRise', 'planContentLeaving', 'planLimitLowering', 'paymentReported', 'cardPaymentApplied'));--> statement-breakpoint
SELECT app_protect_platform_table('public.platform_notifications'::regclass);--> statement-breakpoint
SELECT app_protect_platform_table('public.platform_notification_receipts'::regclass);--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
