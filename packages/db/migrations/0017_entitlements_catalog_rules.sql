-- Platform catalog (ADR-011): every context reads it, only system context writes it,
-- so a tenant code path can never change a plan (ADR-010: admin functions only).
-- A statement trigger, not RLS: a refused RLS UPDATE matches no rows and succeeds.
CREATE FUNCTION public.app_require_system_write() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.app_is_system() THEN
    RAISE EXCEPTION '% on % needs system context', TG_OP, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.app_protect_platform_table(target regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER platform_write BEFORE INSERT OR UPDATE ON %s
       FOR EACH STATEMENT EXECUTE FUNCTION app_require_system_write()',
    target);
END;
$$;
--> statement-breakpoint
SELECT app_protect_platform_table('public.features'::regclass);
--> statement-breakpoint
SELECT app_protect_platform_table('public.modules'::regclass);
--> statement-breakpoint
SELECT app_protect_platform_table('public.module_features'::regclass);
--> statement-breakpoint
SELECT app_protect_platform_table('public.plans'::regclass);
--> statement-breakpoint
SELECT app_protect_platform_table('public.plan_modules'::regclass);
--> statement-breakpoint
SELECT app_protect_platform_table('public.plan_limits'::regclass);
--> statement-breakpoint
-- Feature keys come from the code registry, synced by the migrate step only.
REVOKE INSERT, UPDATE ON features FROM comprobify_erp_app;
