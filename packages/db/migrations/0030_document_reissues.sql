-- FR-DOC-6. The foreign key to documents is checked with a query on a table under
-- forced RLS (CLAUDE.md mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "document_reissues" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"previous_access_key" text NOT NULL,
	"previous_issue_date" date NOT NULL,
	"previous_signed_xml" text NOT NULL,
	"access_key" text NOT NULL,
	"issue_date" date NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_reissues_previous_key_unique" UNIQUE("previous_access_key"),
	CONSTRAINT "document_reissues_reason_check" CHECK (reason IN ('AUTO_NEXT_DAY', 'MANUAL', 'CORRECTED'))
);
--> statement-breakpoint
ALTER TABLE "document_reissues" ADD CONSTRAINT "document_reissues_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reissues" ADD CONSTRAINT "document_reissues_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_reissues_document_idx" ON "document_reissues" USING btree ("document_id");--> statement-breakpoint
SELECT app_enable_tenant_rls('public.document_reissues'::regclass);
--> statement-breakpoint
-- A re-issue's record is history: never rewritten.
REVOKE UPDATE ON document_reissues FROM comprobify_erp_app;
--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
