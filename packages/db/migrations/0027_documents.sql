-- The foreign keys to issue_points, clients and products are checked with a query on
-- tables under forced RLS (CLAUDE.md mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "document_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sri_response" text,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_events_type_check" CHECK (type IN ('CREATED', 'STATUS_CHANGED', 'SRI_RESPONSE', 'CORRECTED', 'REISSUED', 'VOIDED', 'EMAILED')),
	CONSTRAINT "document_events_from_check" CHECK (from_status IN ('SIGNED', 'PENDING_SEND', 'RECEIVED', 'RETURNED', 'SEND_FAILED', 'AUTHORIZED', 'NOT_AUTHORIZED', 'VOIDED')),
	CONSTRAINT "document_events_to_check" CHECK (to_status IN ('SIGNED', 'PENDING_SEND', 'RECEIVED', 'RETURNED', 'SEND_FAILED', 'AUTHORIZED', 'NOT_AUTHORIZED', 'VOIDED'))
);
--> statement-breakpoint
CREATE TABLE "document_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid,
	"code" text NOT NULL,
	"auxiliary_code" text,
	"name" text NOT NULL,
	"unit" text,
	"quantity" numeric(18, 6) NOT NULL,
	"unit_price" numeric(18, 6) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"iva_rate_code" text NOT NULL,
	"iva_percent" numeric(5, 2) NOT NULL,
	"base" numeric(14, 2) NOT NULL,
	"iva" numeric(14, 2) NOT NULL,
	"additional_details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "document_lines_position_unique" UNIQUE("document_id","revision","position"),
	CONSTRAINT "document_lines_iva_rate_check" CHECK (iva_rate_code IN ('0', '2', '3', '4', '5', '6', '7', '8', '10')),
	CONSTRAINT "document_lines_amounts_check" CHECK (quantity > 0 AND unit_price >= 0 AND discount >= 0 AND base >= 0 AND iva >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"position" integer NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"term" integer,
	"term_unit" text,
	CONSTRAINT "document_payments_position_unique" UNIQUE("document_id","revision","position"),
	CONSTRAINT "document_payments_method_check" CHECK (method IN ('01', '15', '16', '17', '18', '19', '20', '21')),
	CONSTRAINT "document_payments_term_unit_check" CHECK (term_unit IN ('dias', 'meses')),
	CONSTRAINT "document_payments_amount_check" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"issue_point_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"series" text NOT NULL,
	"sequential" integer NOT NULL,
	"ambiente" text NOT NULL,
	"access_key" text NOT NULL,
	"issue_date" date NOT NULL,
	"status" text DEFAULT 'SIGNED' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"client_id" uuid,
	"buyer_id_type" text NOT NULL,
	"buyer_identification" text NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_address" text,
	"buyer_email" text,
	"subtotal" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"tax_totals" jsonb NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"signed_xml" text,
	"authorization_number" text,
	"authorized_at" timestamp with time zone,
	"authorization_xml" text,
	"idempotency_key" text,
	"payload_hash" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_sequential_unique" UNIQUE("issue_point_id","document_type","sequential"),
	CONSTRAINT "documents_access_key_unique" UNIQUE("access_key"),
	CONSTRAINT "documents_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "documents_type_check" CHECK (document_type IN ('01', '03', '04', '05', '06', '07')),
	CONSTRAINT "documents_status_check" CHECK (status IN ('SIGNED', 'PENDING_SEND', 'RECEIVED', 'RETURNED', 'SEND_FAILED', 'AUTHORIZED', 'NOT_AUTHORIZED', 'VOIDED')),
	CONSTRAINT "documents_ambiente_check" CHECK (ambiente IN ('1', '2')),
	CONSTRAINT "documents_buyer_id_type_check" CHECK (buyer_id_type IN ('04', '05', '06', '07', '08')),
	CONSTRAINT "documents_series_check" CHECK (series ~ '^[0-9]{6}$'),
	CONSTRAINT "documents_sequential_check" CHECK (sequential BETWEEN 1 AND 999999999),
	CONSTRAINT "documents_access_key_check" CHECK (access_key ~ '^[0-9]{49}$'),
	CONSTRAINT "documents_amounts_check" CHECK (subtotal >= 0 AND discount >= 0 AND total >= 0)
);
--> statement-breakpoint
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_payments" ADD CONSTRAINT "document_payments_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_issue_point_fk" FOREIGN KEY ("tenant_id","issue_point_id") REFERENCES "public"."issue_points"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_events_document_idx" ON "document_events" USING btree ("document_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_idempotency_key" ON "documents" USING btree ("tenant_id","idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_tenant_status_idx" ON "documents" USING btree ("tenant_id","status");--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
