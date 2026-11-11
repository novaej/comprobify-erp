-- Six notification types and four email templates (ADR-036, ADR-037), and a key so a retried job
-- tells the company once. The CHECKs are re-added over tables with rows, which Postgres validates
-- with a query: system context (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
ALTER TABLE "email_templates" DROP CONSTRAINT "email_templates_template_check";--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_unique" ON "notifications" USING btree ("tenant_id","dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_template_check" CHECK (template IN ('verifyEmail', 'resetPassword', 'invitation', 'renewalDue', 'graceStarted', 'pastDue', 'movedToFree', 'paymentRepriced', 'renewalRepriced', 'paymentVerified', 'paymentRejected', 'documentRejected', 'documentSendFailed', 'documentOverdue', 'batchCompleted'));--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_type_check" CHECK (type IN ('RENEWAL_DUE', 'GRACE_STARTED', 'PAST_DUE', 'MOVED_TO_FREE', 'PAYMENT_REPRICED', 'RENEWAL_REPRICED', 'PAYMENT_VERIFIED', 'PAYMENT_REJECTED', 'DOCUMENT_REJECTED', 'DOCUMENT_SEND_FAILED', 'DOCUMENT_OVERDUE', 'DOCUMENT_REISSUED', 'DOCUMENTS_AUTHORIZED', 'BATCH_COMPLETED'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK (type IN ('RENEWAL_DUE', 'GRACE_STARTED', 'PAST_DUE', 'MOVED_TO_FREE', 'PAYMENT_REPRICED', 'RENEWAL_REPRICED', 'PAYMENT_VERIFIED', 'PAYMENT_REJECTED', 'DOCUMENT_REJECTED', 'DOCUMENT_SEND_FAILED', 'DOCUMENT_OVERDUE', 'DOCUMENT_REISSUED', 'DOCUMENTS_AUTHORIZED', 'BATCH_COMPLETED'));--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
