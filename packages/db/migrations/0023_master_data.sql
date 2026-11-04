CREATE TABLE "clients" (
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
	CONSTRAINT "clients_tenant_identification_unique" UNIQUE("tenant_id","id_type","identification"),
	CONSTRAINT "clients_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "clients_id_type_check" CHECK (id_type IN ('04', '05', '06', '08')),
	CONSTRAINT "clients_term_unit_check" CHECK (payment_term_unit IN ('dias', 'meses')),
	CONSTRAINT "clients_payment_term_check" CHECK ((payment_term IS NULL) = (payment_term_unit IS NULL) AND (payment_term IS NULL OR payment_term > 0))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"auxiliary_code" text,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"unit" text,
	"price" numeric(18, 6) NOT NULL,
	"cost" numeric(18, 6),
	"iva_rate_code" text NOT NULL,
	"tracks_stock" boolean DEFAULT false NOT NULL,
	"additional_details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "products_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "products_kind_check" CHECK (kind IN ('GOOD', 'SERVICE')),
	CONSTRAINT "products_iva_rate_check" CHECK (iva_rate_code IN ('0', '2', '3', '4', '5', '6', '7', '8', '10')),
	CONSTRAINT "products_price_check" CHECK (price >= 0 AND (cost IS NULL OR cost >= 0)),
	CONSTRAINT "products_details_check" CHECK (jsonb_typeof(additional_details) = 'array' AND jsonb_array_length(additional_details) <= 3)
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;