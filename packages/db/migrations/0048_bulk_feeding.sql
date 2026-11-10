-- FR-BULK-4 (ADR-026): when the feeder queued an item's job.
ALTER TABLE "bulk_batch_items" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "bulk_batch_items_waiting" ON "bulk_batch_items" USING btree ("tenant_id","batch_id","position") WHERE status = 'QUEUED' AND dispatched_at IS NULL;