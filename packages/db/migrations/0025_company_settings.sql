-- The foreign keys to issue_points are checked with a query, and issue_points has rows
-- under forced RLS (CLAUDE.md mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"issue_point_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_sequences_unique" UNIQUE("issue_point_id","document_type"),
	CONSTRAINT "document_sequences_type_check" CHECK (document_type IN ('01', '03', '04', '05', '06', '07')),
	CONSTRAINT "document_sequences_value_check" CHECK (next_value BETWEEN 1 AND 999999999)
);
--> statement-breakpoint
CREATE TABLE "issue_point_document_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"issue_point_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_point_document_types_unique" UNIQUE("issue_point_id","document_type"),
	CONSTRAINT "issue_point_document_types_type_check" CHECK (document_type IN ('01', '03', '04', '05', '06', '07'))
);
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_action_check";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "special_taxpayer_resolution" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "withholding_agent_resolution" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tax_regime" text DEFAULT 'GENERAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_issue_point_fk" FOREIGN KEY ("tenant_id","issue_point_id") REFERENCES "public"."issue_points"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_point_document_types" ADD CONSTRAINT "issue_point_document_types_issue_point_fk" FOREIGN KEY ("tenant_id","issue_point_id") REFERENCES "public"."issue_points"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_check" CHECK (action IN ('organization.created', 'organization.went_live', 'organization.two_factor_requirement_changed', 'organization.settings_changed', 'branch.created', 'branch.updated', 'issue_point.created', 'issue_point.document_types_changed', 'issue_point.paused_changed', 'sequence.starting_set', 'certificate.uploaded', 'member.invited', 'member.invitation_revoked', 'member.joined', 'member.role_changed', 'member.removed', 'member.issue_points_changed', 'agreements.accepted', 'session.started', 'subscription.plan_changed', 'subscription.billing_changed', 'subscription.price_changed', 'subscription.module_added', 'subscription.module_removed', 'subscription.limit_set', 'subscription.limit_cleared', 'entitlements.override_set', 'entitlements.override_cleared'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_tax_regime_check" CHECK (tax_regime IN ('GENERAL', 'RIMPE_EMPRENDEDOR', 'RIMPE_NEGOCIO_POPULAR'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_special_taxpayer_check" CHECK (special_taxpayer_resolution IS NULL OR special_taxpayer_resolution ~ '^[A-Za-z0-9]{3,13}$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_withholding_agent_check" CHECK (withholding_agent_resolution IS NULL OR withholding_agent_resolution ~ '^[0-9]{1,8}$');--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
