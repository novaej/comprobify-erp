-- FR-SAL-10 (ADR-024). Foreign keys are checked with queries under forced RLS (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "invoice_payments_amount_check" CHECK (amount > 0),
	CONSTRAINT "invoice_payments_method_check" CHECK (method IN ('01', '15', '16', '17', '18', '19', '20', '21')),
	CONSTRAINT "invoice_payments_void_check" CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_payments_document" ON "invoice_payments" USING btree ("tenant_id","document_id");
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.invoice_payments'::regclass);--> statement-breakpoint
-- A payment is never edited or deleted: only voided, with who and why (rule 12).
REVOKE UPDATE ON invoice_payments FROM comprobify_erp_app;--> statement-breakpoint
GRANT UPDATE (voided_at, voided_by, void_reason) ON invoice_payments TO comprobify_erp_app;--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
