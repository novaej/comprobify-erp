-- Every call to SRI (FR-DOC-13). The foreign key to documents is checked with a query on
-- a table under forced RLS (CLAUDE.md mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "sri_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"outcome" text NOT NULL,
	"http_status" integer,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw" text,
	"error" text,
	"duration_ms" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sri_exchanges_operation_check" CHECK (operation IN ('reception', 'authorization', 'validity')),
	CONSTRAINT "sri_exchanges_outcome_check" CHECK (outcome IN ('RECEIVED', 'RETURNED', 'AUTHORIZED', 'NOT_AUTHORIZED', 'PENDING', 'PENDING_VOID', 'VOIDED', 'NOT_FOUND', 'TRANSPORT_ERROR'))
);
--> statement-breakpoint
ALTER TABLE "sri_exchanges" ADD CONSTRAINT "sri_exchanges_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sri_exchanges_document_idx" ON "sri_exchanges" USING btree ("document_id","occurred_at");--> statement-breakpoint
SELECT app_enable_tenant_rls('public.sri_exchanges'::regclass);
--> statement-breakpoint
-- What SRI answered is history: never rewritten.
REVOKE UPDATE ON sri_exchanges FROM comprobify_erp_app;
--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
