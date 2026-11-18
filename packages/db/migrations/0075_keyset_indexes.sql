-- NFR-PERF-4: keyset paths for Comprobantes, a product's movements and a member's notifications.
CREATE INDEX "documents_tenant_recent_idx" ON "documents" USING btree ("tenant_id","issue_date","sequential","id");--> statement-breakpoint
CREATE INDEX "stock_movements_product_id" ON "stock_movements" USING btree ("tenant_id","product_id","id");--> statement-breakpoint
CREATE INDEX "notification_receipts_user_id" ON "notification_receipts" USING btree ("tenant_id","user_id","id");