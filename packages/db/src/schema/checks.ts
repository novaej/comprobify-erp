import { sql, type SQL } from 'drizzle-orm';

// Builds `column IN (...)` from a TypeScript list, so the CHECK and the code
// share one source (CLAUDE.md rule 17). Values are our constants, never input.
export function oneOf(column: string, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql.raw(`${column} IN (${list})`);
}

// The body of a trigger that enforces a status machine, generated from its TypeScript
// definition so the two can't drift (FR-DOC-3, rule 17). A migration holds its output, and
// a test compares the live function with it.
export function transitionTriggerBody<Status extends string>(
  label: string,
  statuses: readonly Status[],
  transitions: Record<Status, readonly Status[]>,
): string {
  const cases = statuses
    .map((from) => {
      const allowed = transitions[from];
      // A terminal status allows nothing: `IN (NULL)` would be NULL, which lets it through.
      const test =
        allowed.length > 0
          ? `NEW.status IN (${allowed.map((to) => `'${to}'`).join(', ')})`
          : 'false';
      return `    WHEN '${from}' THEN ${test}`;
    })
    .join('\n');
  return `IF NEW.status IS DISTINCT FROM OLD.status AND NOT (CASE OLD.status
${cases}
    ELSE false
  END) THEN
    RAISE EXCEPTION '${label} status % can not become %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;`;
}
