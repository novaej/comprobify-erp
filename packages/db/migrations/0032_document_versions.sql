-- FR-DOC-7, FR-DOC-13. Who answered each call, and every signed version of a document.
-- The foreign key to documents is checked with a query under forced RLS (mistake 20), and
-- the backfill reads documents.
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"revision" integer NOT NULL,
	"access_key" text NOT NULL,
	"issue_date" date NOT NULL,
	"signed_xml" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_reason_check" CHECK (reason IN ('CREATED', 'CORRECTED', 'REISSUED'))
);
--> statement-breakpoint
ALTER TABLE "sri_exchanges" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "sri_exchanges" ADD COLUMN "host" text;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_versions_document_idx" ON "document_versions" USING btree ("document_id","created_at");--> statement-breakpoint
ALTER TABLE "sri_exchanges" ADD CONSTRAINT "sri_exchanges_source_check" CHECK (source IN ('sri', 'mock'));--> statement-breakpoint
SELECT app_enable_tenant_rls('public.document_versions'::regclass);
--> statement-breakpoint
REVOKE UPDATE ON document_versions FROM comprobify_erp_app;
--> statement-breakpoint
-- The documents signed before this table existed: their current version.
INSERT INTO document_versions (tenant_id, document_id, reason, revision, access_key, issue_date, signed_xml, actor_user_id, created_at)
SELECT tenant_id, id, CASE WHEN revision = 1 THEN 'CREATED' ELSE 'CORRECTED' END, revision, access_key, issue_date, signed_xml, created_by, updated_at
FROM documents WHERE signed_xml IS NOT NULL;
--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
