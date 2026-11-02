import { sql, type SQL } from 'drizzle-orm';

// Builds `column IN (...)` from a TypeScript list, so the CHECK and the code
// share one source (CLAUDE.md rule 17). Values are our constants, never input.
export function oneOf(column: string, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql.raw(`${column} IN (${list})`);
}
