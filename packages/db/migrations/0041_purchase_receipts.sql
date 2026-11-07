-- FR-PUR-2 (ADR-019). Foreign keys are checked with queries under forced RLS (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "purchase_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit_cost" numeric(18, 6) NOT NULL,
	"movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipt_lines_line_unique" UNIQUE("receipt_id","order_line_id"),
	CONSTRAINT "purchase_receipt_lines_quantity_check" CHECK (quantity > 0 AND unit_cost >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"received_date" date NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipts_tenant_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_receipt_fk" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "public"."purchase_receipts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_order_line_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "public"."purchase_order_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_receipts_order" ON "purchase_receipts" USING btree ("tenant_id","order_id","created_at");
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.purchase_receipts'::regclass);--> statement-breakpoint
SELECT app_enable_tenant_rls('public.purchase_receipt_lines'::regclass);--> statement-breakpoint
-- A receipt is a record of what arrived: append-only, as the stock ledger is.
REVOKE UPDATE ON purchase_receipts, purchase_receipt_lines FROM comprobify_erp_app;--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
