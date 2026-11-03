CREATE TABLE "features" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "features_key_kind_unique" UNIQUE("key","kind"),
	CONSTRAINT "features_kind_check" CHECK (kind IN ('BOOLEAN', 'LIMIT'))
);
--> statement-breakpoint
CREATE TABLE "module_features" (
	"module_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"feature_kind" text DEFAULT 'BOOLEAN' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removes_at" timestamp with time zone,
	CONSTRAINT "module_features_module_id_feature_key_pk" PRIMARY KEY("module_id","feature_key"),
	CONSTRAINT "module_features_boolean_check" CHECK (feature_kind = 'BOOLEAN')
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name_es" text NOT NULL,
	"name_en" text NOT NULL,
	"status" text NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modules_key_unique" UNIQUE("key"),
	CONSTRAINT "modules_status_check" CHECK (status IN ('AVAILABLE', 'COMING_SOON'))
);
--> statement-breakpoint
CREATE TABLE "plan_limits" (
	"plan_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"feature_kind" text DEFAULT 'LIMIT' NOT NULL,
	"value" integer,
	CONSTRAINT "plan_limits_plan_id_feature_key_pk" PRIMARY KEY("plan_id","feature_key"),
	CONSTRAINT "plan_limits_limit_check" CHECK (feature_kind = 'LIMIT'),
	CONSTRAINT "plan_limits_value_check" CHECK (value IS NULL OR value >= 0)
);
--> statement-breakpoint
CREATE TABLE "plan_modules" (
	"plan_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removes_at" timestamp with time zone,
	CONSTRAINT "plan_modules_plan_id_module_id_pk" PRIMARY KEY("plan_id","module_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name_es" text NOT NULL,
	"name_en" text NOT NULL,
	"status" text NOT NULL,
	"self_service" boolean NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_key_unique" UNIQUE("key"),
	CONSTRAINT "plans_status_check" CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED'))
);
--> statement-breakpoint
ALTER TABLE "module_features" ADD CONSTRAINT "module_features_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_features" ADD CONSTRAINT "module_features_feature_fk" FOREIGN KEY ("feature_key","feature_kind") REFERENCES "public"."features"("key","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_feature_fk" FOREIGN KEY ("feature_key","feature_kind") REFERENCES "public"."features"("key","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "modules_one_base" ON "modules" USING btree ("is_base") WHERE is_base;