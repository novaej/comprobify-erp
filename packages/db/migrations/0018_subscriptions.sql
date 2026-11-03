CREATE TABLE "subscription_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"module_id" uuid,
	"feature_key" text,
	"feature_kind" text DEFAULT 'LIMIT' NOT NULL,
	"limit_value" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_items_kind_check" CHECK (kind IN ('MODULE', 'LIMIT')),
	CONSTRAINT "subscription_items_limit_kind_check" CHECK (feature_kind = 'LIMIT'),
	CONSTRAINT "subscription_items_shape_check" CHECK (CASE kind
            WHEN 'MODULE' THEN module_id IS NOT NULL AND feature_key IS NULL AND limit_value IS NULL
            WHEN 'LIMIT' THEN module_id IS NULL AND feature_key IS NOT NULL
          END),
	CONSTRAINT "subscription_items_value_check" CHECK (limit_value IS NULL OR limit_value >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"billing" text DEFAULT 'PAID' NOT NULL,
	"complimentary_reason" text,
	"negotiated_monthly_price" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_tenant_unique" UNIQUE("tenant_id"),
	CONSTRAINT "subscriptions_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "subscriptions_billing_check" CHECK (billing IN ('PAID', 'COMPLIMENTARY')),
	CONSTRAINT "subscriptions_complimentary_reason_check" CHECK ((billing = 'COMPLIMENTARY') = (complimentary_reason IS NOT NULL)),
	CONSTRAINT "subscriptions_negotiated_price_check" CHECK (negotiated_monthly_price IS NULL OR negotiated_monthly_price >= 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_feature_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"feature_kind" text NOT NULL,
	"effect" text NOT NULL,
	"limit_value" integer,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_feature_overrides_effect_check" CHECK (effect IN ('GRANT', 'REVOKE', 'LIMIT')),
	CONSTRAINT "tenant_feature_overrides_shape_check" CHECK (CASE effect
            WHEN 'LIMIT' THEN feature_kind = 'LIMIT'
            ELSE feature_kind = 'BOOLEAN' AND limit_value IS NULL
          END),
	CONSTRAINT "tenant_feature_overrides_value_check" CHECK (limit_value IS NULL OR limit_value >= 0)
);
--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_fk" FOREIGN KEY ("tenant_id","subscription_id") REFERENCES "public"."subscriptions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_feature_fk" FOREIGN KEY ("feature_key","feature_kind") REFERENCES "public"."features"("key","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_feature_overrides" ADD CONSTRAINT "tenant_feature_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_feature_overrides" ADD CONSTRAINT "tenant_feature_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_feature_overrides" ADD CONSTRAINT "tenant_feature_overrides_feature_fk" FOREIGN KEY ("feature_key","feature_kind") REFERENCES "public"."features"("key","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_items_active_module" ON "subscription_items" USING btree ("subscription_id","module_id") WHERE active AND kind = 'MODULE';--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_items_active_limit" ON "subscription_items" USING btree ("subscription_id","feature_key") WHERE active AND kind = 'LIMIT';--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_feature_overrides_active_key" ON "tenant_feature_overrides" USING btree ("tenant_id","feature_key") WHERE active;