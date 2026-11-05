-- FR-MD-5. The foreign key to tenants is checked with a query under forced RLS (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_type" text DEFAULT '01' NOT NULL,
	"name" text NOT NULL,
	"content" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_templates_type_check" CHECK (document_type IN ('01', '03', '04', '05', '06', '07'))
);
--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_templates_name" ON "document_templates" USING btree ("tenant_id","document_type",lower("name")) WHERE active;--> statement-breakpoint
SELECT app_enable_tenant_rls('public.document_templates'::regclass);
--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
