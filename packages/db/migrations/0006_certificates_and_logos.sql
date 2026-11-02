CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"certificate_pem" text NOT NULL,
	"fingerprint" text NOT NULL,
	"subject_name" text NOT NULL,
	"issuer_name" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificates_fingerprint_check" CHECK ("certificates"."fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "tenant_logos" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"content" "bytea" NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_logos_type_check" CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif')),
	CONSTRAINT "tenant_logos_size_check" CHECK (octet_length("tenant_logos"."content") <= 512000)
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "required_accounting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_logos" ADD CONSTRAINT "tenant_logos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_one_active_idx" ON "certificates" USING btree ("tenant_id") WHERE "certificates"."active";