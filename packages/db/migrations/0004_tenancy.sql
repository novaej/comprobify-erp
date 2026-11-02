CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_tenant_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "branches_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "branches_code_check" CHECK ("branches"."code" ~ '^[0-9]{3}$')
);
--> statement-breakpoint
CREATE TABLE "issue_points" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"can_issue" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_points_branch_code_unique" UNIQUE("branch_id","code"),
	CONSTRAINT "issue_points_code_check" CHECK ("issue_points"."code" ~ '^[0-9]{3}$')
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_user_unique" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK (role IN ('OWNER', 'ADMIN', 'SALES', 'PURCHASING', 'ACCOUNTANT', 'VIEWER'))
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ruc" text NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"main_address" text NOT NULL,
	"mode" text NOT NULL,
	"twin_of" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"idle_timeout_minutes" integer DEFAULT 30 NOT NULL,
	"live_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_ruc_mode_unique" UNIQUE("ruc","mode"),
	CONSTRAINT "tenants_ruc_check" CHECK ("tenants"."ruc" ~ '^[0-9]{13}$'),
	CONSTRAINT "tenants_mode_check" CHECK (mode IN ('TEST', 'PRODUCTION')),
	CONSTRAINT "tenants_status_check" CHECK (status IN ('ACTIVE', 'SUSPENDED')),
	CONSTRAINT "tenants_twin_check" CHECK (("tenants"."mode" = 'TEST') = ("tenants"."twin_of" IS NOT NULL)),
	CONSTRAINT "tenants_idle_timeout_check" CHECK ("tenants"."idle_timeout_minutes" BETWEEN 5 AND 480)
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_branch_unique" UNIQUE("branch_id")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_points" ADD CONSTRAINT "issue_points_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_twin_of_tenants_id_fk" FOREIGN KEY ("twin_of") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_fk" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");