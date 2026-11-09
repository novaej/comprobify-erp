-- FR-SAL-3 (ADR-022). Foreign keys are checked with queries under forced RLS (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "sale_order_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_revision" integer NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_order_invoice_lines_unique" UNIQUE("document_id","document_revision","order_line_id"),
	CONSTRAINT "sale_order_invoice_lines_quantity_check" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "sale_order_invoice_lines" ADD CONSTRAINT "sale_order_invoice_lines_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."sale_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_order_invoice_lines" ADD CONSTRAINT "sale_order_invoice_lines_line_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "public"."sale_order_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_order_invoice_lines" ADD CONSTRAINT "sale_order_invoice_lines_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_order_invoice_lines_order" ON "sale_order_invoice_lines" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "sale_order_invoice_lines_document" ON "sale_order_invoice_lines" USING btree ("tenant_id","document_id");
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.sale_order_invoice_lines'::regclass);--> statement-breakpoint
-- Append-only: a correction adds rows for its revision instead of changing these (rule 12).
REVOKE UPDATE ON sale_order_invoice_lines FROM comprobify_erp_app;--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
