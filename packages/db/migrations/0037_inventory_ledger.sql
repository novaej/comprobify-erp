-- FR-INV-1, FR-INV-2, FR-INV-4 (ADR-018). Foreign keys are checked with queries under forced
-- RLS (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"on_hand" numeric(18, 6) DEFAULT '0' NOT NULL,
	"reserved" numeric(18, 6) DEFAULT '0' NOT NULL,
	"value" numeric(18, 6) DEFAULT '0' NOT NULL,
	"average_cost" numeric(18, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_product_warehouse_unique" UNIQUE("tenant_id","product_id","warehouse_id"),
	CONSTRAINT "stock_levels_reserved_check" CHECK (reserved >= 0),
	CONSTRAINT "stock_levels_average_check" CHECK (average_cost >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"type" text NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"reserved" numeric(18, 6) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 6) NOT NULL,
	"value" numeric(18, 6) NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_type_check" CHECK (type IN ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SALE', 'RETURN_IN', 'RESERVATION', 'RELEASE')),
	CONSTRAINT "stock_movements_source_check" CHECK (source_type IN ('ADJUSTMENT', 'OPENING_IMPORT', 'PURCHASE_RECEIPT', 'DOCUMENT')),
	CONSTRAINT "stock_movements_cost_check" CHECK (unit_cost >= 0),
	CONSTRAINT "stock_movements_source_pair_check" CHECK ((source_type IS NULL) = (source_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "negative_stock" text DEFAULT 'BLOCK' NOT NULL;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_level_fk" FOREIGN KEY ("tenant_id","product_id","warehouse_id") REFERENCES "public"."stock_levels"("tenant_id","product_id","warehouse_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_level" ON "stock_movements" USING btree ("tenant_id","product_id","warehouse_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_source" ON "stock_movements" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_negative_stock_check" CHECK (negative_stock IN ('BLOCK', 'ALLOW'));
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.stock_levels'::regclass);--> statement-breakpoint
SELECT app_enable_tenant_rls('public.stock_movements'::regclass);--> statement-breakpoint
CREATE TRIGGER stock_levels_touch_updated_at BEFORE UPDATE ON stock_levels
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();--> statement-breakpoint
-- The ledger is append-only: no UPDATE, on top of the DELETE the app role never has.
REVOKE UPDATE ON stock_movements FROM comprobify_erp_app;--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
