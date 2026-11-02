import type { QueryResultRow } from 'pg';

export type Queryable = {
  query: <Row extends QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: Row[] }>;
};

export class UnsafeDatabaseError extends Error {
  override readonly name = 'UnsafeDatabaseError';
}

// The form pg_get_expr prints for the policy app_enable_tenant_rls creates.
const STANDARD_EXPRESSION = '(app_is_system() OR (tenant_id = app_require_tenant_id()))';

type CatalogRow = {
  name: string;
  enabled: boolean;
  forced: boolean;
  standard: boolean;
  permissive: number;
};

// NFR-SEC-5: no allow-list. Shared by the boot guard and the catalog test.
export async function findUnprotectedTables(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<CatalogRow>(
    `SELECT format('%I.%I', n.nspname, c.relname) AS name,
            c.relrowsecurity AS enabled,
            c.relforcerowsecurity AS forced,
            EXISTS (
              SELECT 1 FROM pg_policy p
              WHERE p.polrelid = c.oid
                AND p.polname = 'tenant_isolation'
                AND p.polcmd = '*'
                AND p.polpermissive
                AND p.polroles = '{0}'
                AND pg_get_expr(p.polqual, p.polrelid) = $1
                AND pg_get_expr(p.polwithcheck, p.polrelid) = $1
            ) AS standard,
            (SELECT count(*)::int FROM pg_policy p
             WHERE p.polrelid = c.oid AND p.polpermissive) AS permissive
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a
       ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT LIKE 'pg\\_%'
       AND n.nspname NOT IN ('information_schema', 'pgboss', 'drizzle')
     ORDER BY 1`,
    [STANDARD_EXPRESSION],
  );

  return rows.flatMap((row) => {
    const problems: string[] = [];
    if (!row.enabled) problems.push(`${row.name}: RLS is not enabled`);
    if (!row.forced) problems.push(`${row.name}: RLS is not forced`);
    if (!row.standard) problems.push(`${row.name}: standard policy is missing`);
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
