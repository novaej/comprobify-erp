-- Fail-loud RLS (ADR-004, NFR-SEC-1) and app role grants (ADR-003, NFR-SEC-4).

CREATE FUNCTION public.app_is_system() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT COALESCE(current_setting('app.rls_system', true), '') = 'on' $$;
--> statement-breakpoint

-- The system check lives here too: Postgres may evaluate both sides of an OR.
-- A local setting reverts to '' after its transaction, not to NULL.
CREATE FUNCTION public.app_require_tenant_id() RETURNS uuid
  LANGUAGE plpgsql STABLE
  AS $$
DECLARE
  tenant text := NULLIF(current_setting('app.tenant_id', true), '');
BEGIN
  IF tenant IS NOT NULL THEN
    RETURN tenant::uuid;
  END IF;
  IF public.app_is_system() THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'RLS: no tenant or system context' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint

CREATE FUNCTION public.app_enable_tenant_rls(target regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s
       USING (app_is_system() OR tenant_id = app_require_tenant_id())
       WITH CHECK (app_is_system() OR tenant_id = app_require_tenant_id())',
    target
  );
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_enable_tenant_rls(regclass) FROM PUBLIC;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO comprobify_erp_app;
--> statement-breakpoint

-- No DELETE: no hard deletes, enforced by the database.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO comprobify_erp_app;
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO comprobify_erp_app;
