CREATE TABLE "agreement_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"version" integer NOT NULL,
	"content_markdown" text NOT NULL,
	"content_hash" text NOT NULL,
	"accepted_by" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "agreement_acceptances_tenant_template_unique" UNIQUE("tenant_id","template_id"),
	CONSTRAINT "agreement_acceptances_type_check" CHECK (document_type IN ('TERMS', 'PRIVACY', 'DPA'))
);
--> statement-breakpoint
CREATE TABLE "agreement_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"document_type" text NOT NULL,
	"version" integer NOT NULL,
	"content_markdown" text NOT NULL,
	"content_hash" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_templates_type_version_unique" UNIQUE("document_type","version"),
	CONSTRAINT "agreement_templates_type_check" CHECK (document_type IN ('TERMS', 'PRIVACY', 'DPA'))
);
--> statement-breakpoint
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_template_id_agreement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agreement_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;