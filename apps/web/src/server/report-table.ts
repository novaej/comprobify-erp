import 'server-only';
import type { ColumnKind, ReportResult } from '@comprobify/core';
import { getTranslations } from 'next-intl/server';

// A report's cells written out for a person: the screen's (dates, currency) or the file's (ISO
// dates, bare numbers a spreadsheet reads). Codes become words in the reader's language.
export type ReportTable = {
  headers: string[];
  columns: { key: string; kind: ColumnKind }[];
  rows: string[][];
  totals: string[] | null;
};

export async function reportTable(
  result: ReportResult,
  locale: string,
  mode: 'screen' | 'csv',
): Promise<ReportTable> {
  const t = await getTranslations({ locale, namespace: 'reports' });
  const tDocs = await getTranslations({ locale, namespace: 'documents' });
  const tBuckets = await getTranslations({ locale, namespace: 'receivables.buckets' });
  const tMovements = await getTranslations({ locale, namespace: 'inventory.types' });
  const spanish = locale !== 'en';
  const tag = spanish ? 'es-EC' : 'en';
  const money = new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD' });
  const quantity = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });

  const code = (key: string, value: string) => {
    if (key === 'status' && tDocs.has(`statuses.${value}` as 'statuses.AUTHORIZED'))
      return tDocs(`statuses.${value}` as 'statuses.AUTHORIZED');
    if (key === 'type' && tDocs.has(`types.${value}` as 'types.01'))
      return tDocs(`types.${value}` as 'types.01');
    if (key === 'movement' && tMovements.has(value as 'SALE')) return tMovements(value as 'SALE');
    if (key === 'bucket' && tBuckets.has(value as 'CURRENT')) return tBuckets(value as 'CURRENT');
    return value;
  };
  const cell = (kind: ColumnKind, key: string, value: string): string => {
    if (value === '') return '';
    if (mode === 'csv') {
      // Spanish spreadsheets read ',' as the decimal mark.
      if (kind === 'amount' || kind === 'quantity' || kind === 'percent')
        return spanish ? value.replace('.', ',') : value;
      return kind === 'code' ? code(key, value) : value;
    }
    switch (kind) {
      case 'date':
        return value.split('-').reverse().join('/');
      case 'amount':
        return money.format(value as Intl.StringNumericLiteral);
      case 'quantity':
        return quantity.format(Number(value));
      case 'percent':
        return `${Number(value)} %`;
      case 'code':
        return code(key, value);
      default:
        return value;
    }
  };
  const columnLabel = (key: string) => t(`columns.${key}` as 'columns.date', {});
  return {
    headers: result.columns.map((column) => columnLabel(column.key)),
    columns: result.columns,
    rows: result.rows.map((row) =>
      row.map((value, index) =>
        cell(result.columns[index]!.kind, result.columns[index]!.key, value),
      ),
    ),
    totals: result.totals
      ? result.totals.map((value, index) =>
          cell(result.columns[index]!.kind, result.columns[index]!.key, value),
        )
      : null,
  };
}
