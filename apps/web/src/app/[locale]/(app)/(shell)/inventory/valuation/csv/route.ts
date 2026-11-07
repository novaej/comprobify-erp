import { isDomainError, stockValuation } from '@comprobify/core';
import { getTranslations } from 'next-intl/server';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

// A cell as spreadsheets read it: quoted when it holds the delimiter, a quote or a line break.
const cell = (value: string, delimiter: string) =>
  value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

// FR-INV-5: the valuation's lines, in the format the locale's spreadsheet opens directly.
export async function GET(_: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { actor } = await loadShell(locale);
  const { db } = await getRuntime();
  try {
    const valuation = await stockValuation(actor, db);
    const t = await getTranslations({ locale, namespace: 'inventory.valuation.csv' });
    // Spanish Excel: ';' between fields and ',' for decimals.
    const spanish = locale !== 'en';
    const delimiter = spanish ? ';' : ',';
    const number = (value: string) => (spanish ? value.replace('.', ',') : value);
    const header = [
      'branch',
      'warehouse',
      'code',
      'product',
      'unit',
      'onHand',
      'reserved',
      'averageCost',
      'value',
    ].map((key) => t(key as 'branch'));
    const lines = valuation.lines.map((line) =>
      [
        line.branchCode,
        line.warehouseName,
        line.code,
        line.name,
        line.unit ?? '',
        number(line.onHand),
        number(line.reserved),
        number(line.averageCost),
        number(line.value),
      ]
        .map((value) => cell(value, delimiter))
        .join(delimiter),
    );
    const body = `\uFEFF${[header.join(delimiter), ...lines].join('\r\n')}\r\n`;
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${t('filename')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isDomainError(error)) return new Response(null, { status: 404 });
    throw error;
  }
}
