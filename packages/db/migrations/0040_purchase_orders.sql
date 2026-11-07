-- FR-PUR-1 (ADR-019). Foreign keys are checked with queries under forced RLS (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit" text,
	"quantity" numeric(18, 6) NOT NULL,
	"received_quantity" numeric(18, 6) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 6) NOT NULL,
	"iva_rate_code" text NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"iva" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_lines_position_unique" UNIQUE("order_id","revision","position"),
	CONSTRAINT "purchase_order_lines_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_order_lines_iva_check" CHECK (iva_rate_code IN ('0', '2', '3', '4', '5', '6', '7', '8', '10')),
	CONSTRAINT "purchase_order_lines_quantity_check" CHECK (quantity > 0 AND received_quantity >= 0 AND received_quantity <= quantity),
	CONSTRAINT "purchase_order_lines_amounts_check" CHECK (unit_cost >= 0 AND subtotal >= 0 AND iva >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"provider_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"notes" text,
	"subtotal" numeric(14, 2) NOT NULL,
	"iva" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"sent_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_tenant_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "purchase_orders_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_orders_status_check" CHECK (status IN ('DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED')),
	CONSTRAINT "purchase_orders_number_check" CHECK (number > 0 AND revision > 0),
	CONSTRAINT "purchase_orders_amounts_check" CHECK (subtotal >= 0 AND iva >= 0 AND total = subtotal + iva),
	CONSTRAINT "purchase_orders_expected_check" CHECK (expected_date IS NULL OR expected_date >= order_date),
	CONSTRAINT "purchase_orders_cancel_check" CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "tenant_counters" (
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "tenant_counters_tenant_id_kind_pk" PRIMARY KEY("tenant_id","kind"),
	CONSTRAINT "tenant_counters_kind_check" CHECK (kind IN ('PURCHASE_ORDER')),
	CONSTRAINT "tenant_counters_value_check" CHECK (last_value > 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_provider_fk" FOREIGN KEY ("tenant_id","provider_id") REFERENCES "public"."providers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_fk" FOREIGN KEY ("tenant_id","warehouse_id") REFERENCES "public"."warehouses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_counters" ADD CONSTRAINT "tenant_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_orders_provider" ON "purchase_orders" USING btree ("tenant_id","provider_id");
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.purchase_orders'::regclass);--> statement-breakpoint
SELECT app_enable_tenant_rls('public.purchase_order_lines'::regclass);--> statement-breakpoint
SELECT app_enable_tenant_rls('public.tenant_counters'::regclass);--> statement-breakpoint
CREATE TRIGGER purchase_orders_touch_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();--> statement-breakpoint
-- A line changes only as goods arrive; an edited draft adds a revision instead (rule 12).
REVOKE UPDATE ON purchase_order_lines FROM comprobify_erp_app;--> statement-breakpoint
GRANT UPDATE (received_quantity) ON purchase_order_lines TO comprobify_erp_app;--> statement-breakpoint
-- FR-DOC-3. Generated by purchaseOrderStatusTriggerBody() from PURCHASE_ORDER_TRANSITIONS
-- (rule 17); the purchase orders integration test fails if this copy and the definition differ.
CREATE FUNCTION public.app_purchase_order_status_check() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
IF NEW.status IS DISTINCT FROM OLD.status AND NOT (CASE OLD.status
    WHEN 'DRAFT' THEN NEW.status IN ('SENT', 'CANCELLED')
    WHEN 'SENT' THEN NEW.status IN ('PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')
    WHEN 'PARTIALLY_RECEIVED' THEN NEW.status IN ('RECEIVED', 'CLOSED')
    WHEN 'RECEIVED' THEN NEW.status IN ('CLOSED')
    WHEN 'CLOSED' THEN false
    WHEN 'CANCELLED' THEN false
    ELSE false
  END) THEN
    RAISE EXCEPTION 'Purchase order status % can not become %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER purchase_order_status_check BEFORE UPDATE OF status ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION app_purchase_order_status_check();--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
