-- FR-MD-3. The foreign key to tenants is checked with a query under forced RLS (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"id_type" text NOT NULL,
	"identification" text NOT NULL,
	"name" text NOT NULL,
	"emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"phone" text,
	"address" text,
	"payment_term" integer,
	"payment_term_unit" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_tenant_identification_unique" UNIQUE("tenant_id","id_type","identification"),
	CONSTRAINT "providers_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "providers_id_type_check" CHECK (id_type IN ('04', '05', '06', '08')),
	CONSTRAINT "providers_term_unit_check" CHECK (payment_term_unit IN ('dias', 'meses')),
	CONSTRAINT "providers_payment_term_check" CHECK ((payment_term IS NULL) = (payment_term_unit IS NULL) AND (payment_term IS NULL OR payment_term > 0))
);
--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
SELECT app_enable_tenant_rls('public.providers'::regclass);--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
