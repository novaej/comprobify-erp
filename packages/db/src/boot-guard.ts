import type { QueryResultRow } from 'pg';

export type Queryable = {
  query: <Row extends QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: Row[] }>;
};

export class UnsafeDatabaseError extends Error {
  override readonly name = 'UnsafeDatabaseError';
}

// The forms pg_get_expr prints for our policies.
const STANDARD_EXPRESSION = '(app_is_system() OR (tenant_id = app_require_tenant_id()))';

// ADR-010: the only tables with a policy other than the standard one. Each must
// have exactly this policy; every other tenant_id table must have the standard one.
const SPECIAL_POLICIES: Record<string, { name: string; using: string; check: string }> = {
  'public.memberships': {
    name: 'tenant_or_user',
    using: 'app_can_see_membership(tenant_id, user_id)',
    check: STANDARD_EXPRESSION,
  },
  'public.tenants': {
    name: 'tenant_self',
    using: 'app_can_see_tenant(id)',
    check: '(app_is_system() OR (id = app_require_tenant_id()))',
  },
};

type CatalogRow = {
  name: string;
  enabled: boolean;
  forced: boolean;
  policies: { name: string; command: string; roles: string; using: string; check: string }[];
  permissive: number;
};

// NFR-SEC-5: no allow-list. Shared by the boot guard and the catalog test.
export async function findUnprotectedTables(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<CatalogRow>(
    `SELECT format('%I.%I', n.nspname, c.relname) AS name,
            c.relrowsecurity AS enabled,
            c.relforcerowsecurity AS forced,
            COALESCE((
              SELECT json_agg(json_build_object(
                'name', p.polname,
                'command', p.polcmd,
                'roles', p.polroles::text,
                'using', pg_get_expr(p.polqual, p.polrelid),
                'check', pg_get_expr(p.polwithcheck, p.polrelid)))
              FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive
            ), '[]') AS policies,
            (SELECT count(*)::int FROM pg_policy p
             WHERE p.polrelid = c.oid AND p.polpermissive) AS permissive
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT LIKE 'pg\\_%'
       AND n.nspname NOT IN ('information_schema', 'pgboss', 'drizzle')
       AND (
         EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
         OR format('%I.%I', n.nspname, c.relname) = ANY($1)
       )
     ORDER BY 1`,
    [Object.keys(SPECIAL_POLICIES)],
  );

  return rows.flatMap((row) => {
    const problems: string[] = [];
    if (!row.enabled) problems.push(`${row.name}: RLS is not enabled`);
    if (!row.forced) problems.push(`${row.name}: RLS is not forced`);
    const expected = SPECIAL_POLICIES[row.name] ?? {
      name: 'tenant_isolation',
      using: STANDARD_EXPRESSION,
      check: STANDARD_EXPRESSION,
    };
    const matches = row.policies.some(
      (policy) =>
        policy.name === expected.name &&
        policy.command === '*' &&
        policy.roles === '{0}' &&
        policy.using === expected.using &&
        policy.check === expected.check,
    );
    if (!matches) problems.push(`${row.name}: standard policy is missing`);
    // Permissive policies are OR-ed, so an extra one widens access.
    if (row.permissive > 1) problems.push(`${row.name}: extra permissive policy`);
    return problems;
  });
}

// NFR-SEC-4: a role that bypasses RLS turns every policy into a silent no-op.
export async function assertSafeConnection(db: Queryable): Promise<void> {
  const { rows } = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
  );
  const role = rows[0];
  const problems = await findUnprotectedTables(db);
  if (!role) problems.unshift('connected role was not found');
  if (role?.rolsuper) problems.unshift('connected role is a superuser');
  if (role?.rolbypassrls) problems.unshift('connected role has BYPASSRLS');
  if (problems.length > 0) {
    throw new UnsafeDatabaseError(`Refusing to start:\n  ${problems.join('\n  ')}`);
  }
}
