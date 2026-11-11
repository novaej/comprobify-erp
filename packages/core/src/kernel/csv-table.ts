import { z } from 'zod';
import { DomainError } from './errors';
import { parseCsv, type Csv } from './csv';

// A spreadsheet upload read as a table: the header names columns in either language, every row
// knows its line in the file, and a missing or blank column reads as an empty cell. Shared by
// every CSV import, so each reports its problems the same way: by line, nothing applied unless
// every line is right.

// The line in the file, the header being line 1, and what is wrong there. `field` names the
// column when a value is the problem.
export type CsvProblem = { line: number; code: string; field?: string };

export type CsvColumns<K extends string> = Record<K, readonly string[]>;
export type CsvRow<K extends string> = { line: number; cell: (key: K) => string };
export type CsvTable<K extends string> = {
  delimiter: Csv['delimiter'];
  rows: CsvRow<K>[];
  // Whether the file has the column at all (a blank cell and a missing column differ for updates).
  has: (key: K) => boolean;
};

// Header names without accents or case, spaces as underscores.
export const normalHeader = (header: string) =>
  header.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');

export const CSV_MAX_BYTES = 2_000_000;

export function readCsvTable<K extends string>(
  text: string,
  columns: CsvColumns<K>,
  required: readonly K[],
  maxRows: number,
): CsvTable<K> {
  const parsed = z.string().max(CSV_MAX_BYTES).safeParse(text);
  if (!parsed.success) throw new DomainError('IMPORT_TOO_LARGE', 'The file is too large');
  const csv = parseCsv(parsed.data);
  const [header, ...rows] = csv.rows;
  if (!header) throw new DomainError('IMPORT_EMPTY', 'The file has no rows');
  const names = header.map(normalHeader);
  const keys = Object.keys(columns) as K[];
  const at = Object.fromEntries(
    keys.map((key) => [key, names.findIndex((name) => columns[key].includes(name))]),
  ) as Record<K, number>;
  const missing = required.filter((key) => at[key] < 0);
  if (missing.length > 0)
    throw new DomainError('IMPORT_COLUMNS', 'The file lacks columns it needs', { missing });
  if (rows.length === 0) throw new DomainError('IMPORT_EMPTY', 'The file has no rows');
  if (rows.length > maxRows)
    throw new DomainError('IMPORT_TOO_LARGE', 'The file has too many rows', { max: maxRows });
  return {
    delimiter: csv.delimiter,
    has: (key) => at[key] >= 0,
    rows: rows.map((row, index) => ({
      line: index + 2,
      cell: (key) => (at[key] < 0 ? '' : (row[at[key]] ?? '').trim()),
    })),
  };
}

// Yes or no as people type it; null when it is neither, so a typo is reported and not guessed.
export function csvBoolean(value: string): boolean | null {
  const normal = normalHeader(value);
  if (['yes', 'si', 'true', '1', 'x', 's', 'y'].includes(normal)) return true;
  if (['no', 'false', '0', 'n'].includes(normal)) return false;
  return null;
}
