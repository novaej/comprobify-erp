-- FR-BILL-2, FR-BILL-3 (ADR-029). Foreign keys are checked with queries under forced RLS (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "payment_proofs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"content" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"reference" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "payment_proofs_type_check" CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif', 'application/pdf')),
	CONSTRAINT "payment_proofs_size_check" CHECK (size > 0 AND size <= 2097152),
	CONSTRAINT "payment_proofs_removed_check" CHECK (active = (removed_at IS NULL))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"code" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"method" text,
	"base_amount" numeric(12, 2) NOT NULL,
	"iva_rate" numeric(5, 2) NOT NULL,
	"iva_amount" numeric(12, 2) NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"target_plan_id" uuid,
	"target_interval" text,
	"target_seats" integer,
	"pack_size" integer,
	"pricing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"period_start" date,
	"period_end" date,
	"applied_from" jsonb,
	"rejection_reason" text,
	"refund_reason" text,
	"invoice_document_id" uuid,
	"invoiced_at" timestamp with time zone,
	"created_by" uuid,
	"reported_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"cancelled_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"refunded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_code_unique" UNIQUE("code"),
	CONSTRAINT "payments_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_purpose_check" CHECK (purpose IN ('INITIAL', 'RENEWAL', 'TIER_CHANGE', 'SEAT_CHANGE', 'DOCUMENT_PACK')),
	CONSTRAINT "payments_status_check" CHECK (status IN ('PENDING', 'REPORTED', 'VERIFIED', 'REJECTED', 'CANCELLED', 'REFUNDED')),
	CONSTRAINT "payments_method_check" CHECK (method IS NULL OR method IN ('SPI_TRANSFER', 'PAYPHONE_CARD')),
	CONSTRAINT "payments_rejection_check" CHECK (rejection_reason IS NULL OR rejection_reason IN ('AMOUNT_MISMATCH', 'TRANSFER_NOT_FOUND', 'WRONG_ACCOUNT', 'ILLEGIBLE_PROOF', 'DUPLICATE_SUBMISSION', 'OTHER')),
	CONSTRAINT "payments_code_check" CHECK (code ~ '^CB-[2-9A-HJ-NP-Z]{8}$'),
	CONSTRAINT "payments_amounts_check" CHECK (base_amount >= 0 AND iva_amount >= 0 AND iva_rate >= 0 AND total_amount = base_amount + iva_amount),
	CONSTRAINT "payments_target_check" CHECK (CASE purpose
            WHEN 'INITIAL' THEN target_plan_id IS NOT NULL AND target_interval IS NOT NULL
            WHEN 'TIER_CHANGE' THEN target_plan_id IS NOT NULL AND target_interval IS NOT NULL
            WHEN 'SEAT_CHANGE' THEN target_seats IS NOT NULL AND target_seats >= 0
            WHEN 'DOCUMENT_PACK' THEN pack_size > 0
            ELSE true
          END),
	CONSTRAINT "payments_verified_check" CHECK ((status IN ('VERIFIED', 'REFUNDED')) = (verified_at IS NOT NULL)),
	CONSTRAINT "payments_refunded_check" CHECK ((status = 'REFUNDED') = (refunded_at IS NOT NULL)),
	CONSTRAINT "payments_rejected_check" CHECK ((status = 'REJECTED') = (rejection_reason IS NOT NULL)),
	CONSTRAINT "payments_period_check" CHECK (period_end IS NULL OR period_end > period_start)
);
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_check";--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_target_plan_id_plans_id_fk" FOREIGN KEY ("target_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_by_users_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_fk" FOREIGN KEY ("tenant_id","subscription_id") REFERENCES "public"."subscriptions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_proofs_payment" ON "payment_proofs" USING btree ("tenant_id","payment_id");--> statement-breakpoint
CREATE INDEX "payments_tenant_status" ON "payments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "payments_status" ON "payments" USING btree ("status","reported_at");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_check" CHECK (action IN ('organization.created', 'organization.went_live', 'organization.two_factor_requirement_changed', 'organization.settings_changed', 'branch.created', 'branch.updated', 'issue_point.created', 'issue_point.document_types_changed', 'issue_point.paused_changed', 'sequence.starting_set', 'certificate.uploaded', 'member.invited', 'member.invitation_revoked', 'member.joined', 'member.role_changed', 'member.removed', 'member.issue_points_changed', 'agreements.accepted', 'session.started', 'subscription.plan_changed', 'subscription.billing_changed', 'subscription.price_changed', 'subscription.module_added', 'subscription.module_removed', 'subscription.limit_set', 'subscription.limit_cleared', 'entitlements.override_set', 'entitlements.override_cleared', 'payment.created', 'payment.reported', 'payment.cancelled', 'payment.verified', 'payment.rejected', 'payment.refunded'));
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.payments'::regclass);--> statement-breakpoint
SELECT app_enable_tenant_rls('public.payment_proofs'::regclass);--> statement-breakpoint
CREATE TRIGGER payments_touch_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();--> statement-breakpoint
-- A proof file is never changed: the company can only take it out of its own view (rule 12).
REVOKE UPDATE ON payment_proofs FROM comprobify_erp_app;--> statement-breakpoint
GRANT UPDATE (active, removed_at) ON payment_proofs TO comprobify_erp_app;--> statement-breakpoint
-- FR-DOC-3. Generated by paymentStatusTriggerBody() from PAYMENT_TRANSITIONS (rule 17); the
-- payments integration test fails if this copy and the definition differ.
CREATE FUNCTION public.app_payment_status_check() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
IF NEW.status IS DISTINCT FROM OLD.status AND NOT (CASE OLD.status
    WHEN 'PENDING' THEN NEW.status IN ('REPORTED', 'VERIFIED', 'CANCELLED')
    WHEN 'REPORTED' THEN NEW.status IN ('VERIFIED', 'REJECTED')
    WHEN 'VERIFIED' THEN NEW.status IN ('REFUNDED')
    WHEN 'REJECTED' THEN NEW.status IN ('REPORTED', 'VERIFIED', 'CANCELLED')
    WHEN 'CANCELLED' THEN false
    WHEN 'REFUNDED' THEN false
    ELSE false
  END) THEN
    RAISE EXCEPTION 'Payment status % can not become %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER payment_status_check BEFORE UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION app_payment_status_check();--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
