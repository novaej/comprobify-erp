ALTER TABLE "documents" ADD COLUMN "retry_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "send_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "deadline_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "sri_unreachable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "authorization_checks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "overdue_alerted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "documents_received_idx" ON "documents" USING btree ("received_at") WHERE status = 'RECEIVED' AND overdue_alerted_at IS NULL;