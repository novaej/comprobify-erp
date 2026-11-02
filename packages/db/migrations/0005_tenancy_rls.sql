-- RLS for the tenancy tables (ADR-004, ADR-010).

CREATE FUNCTION public.app_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

-- Set only by withUser, for identity lookups (ADR-010).
CREATE FUNCTION public.app_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- One function per policy, so the raise can't be skipped by short-circuiting.
CREATE FUNCTION public.app_can_see_membership(row_tenant uuid, row_user uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE
  AS $$
BEGIN
  IF public.app_is_system() THEN
    RETURN true;
  END IF;
  IF public.app_tenant_id() IS NOT NULL THEN
    RETURN row_tenant = public.app_tenant_id();
  END IF;
  IF public.app_user_id() IS NOT NULL THEN
    RETURN row_user = public.app_user_id();
  END IF;
  RAISE EXCEPTION 'RLS: no tenant, user or system context' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint

-- In user context, the organizations the user has an active membership in.
-- Twins carry mirrored memberships, so they appear too.
CREATE FUNCTION public.app_can_see_tenant(row_id uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE
  AS $$
BEGIN
  IF public.app_is_system() THEN
    RETURN true;
  END IF;
  IF public.app_tenant_id() IS NOT NULL THEN
    RETURN row_id = public.app_tenant_id();
  END IF;
  IF public.app_user_id() IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.tenant_id = row_id AND m.user_id = public.app_user_id() AND m.active
    );
  END IF;
  RAISE EXCEPTION 'RLS: no tenant, user or system context' USING ERRCODE = '42501';
END
$$;
--> statement-breakpoint

-- Reads accept the user context; writes need the tenant or system context.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_or_user ON memberships
  USING (app_can_see_membership(tenant_id, user_id))
  WITH CHECK (app_is_system() OR tenant_id = app_require_tenant_id());
--> statement-breakpoint

-- The tenant row is the tenant, so its key is id, not tenant_id.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_self ON tenants
  USING (app_can_see_tenant(id))
  WITH CHECK (app_is_system() OR id = app_require_tenant_id());
--> statement-breakpoint

SELECT app_enable_tenant_rls('public.branches'::regclass);
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.issue_points'::regclass);
--> statement-breakpoint
SELECT app_enable_tenant_rls('public.warehouses'::regclass);
--> statement-breakpoint

CREATE TRIGGER tenants_touch_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER branches_touch_updated_at BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER issue_points_touch_updated_at BEFORE UPDATE ON issue_points
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER warehouses_touch_updated_at BEFORE UPDATE ON warehouses
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER memberships_touch_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
