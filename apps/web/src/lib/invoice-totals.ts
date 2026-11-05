// The invoice form's live totals, exactly as core computes them (ADR-012): each line's
// base and IVA rounded half-up to cents, the document summing the rounded lines. Exact
// integer arithmetic, so the screen never disagrees with the stored document by a cent.
// A test holds it to core's documentTotals.

const SCALE = 6;
const TEN = 10n;

// As typed: Ecuador writes the decimal point as a comma.
export const normalizeDecimal = (value: string) => value.trim().replace(',', '.');

// A decimal string with up to 6 places, as micro-units; null when it isn't one.
export function parseDecimal(value: string): bigint | null {
  const match = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(normalizeDecimal(value));
  if (!match) return null;
  return BigInt(match[1]!) * TEN ** BigInt(SCALE) + BigInt((match[2] ?? '').padEnd(SCALE, '0'));
}

// Half-up division for non-negative values.
const divide = (value: bigint, by: bigint) => (value * 2n + by) / (by * 2n);

// micro-units × micro-units → cents.
const toCents = (micro: bigint, scale: number) => divide(micro, TEN ** BigInt(scale - 2));

export const formatCents = (cents: bigint): string => {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};

export type TotalsLine = {
  quantity: string;
  unitPrice: string;
  discount: string;
  ivaRateCode: string;
};

export type LineTotal = { base: bigint; iva: bigint } | null;

export function lineTotal(line: TotalsLine, percents: Map<string, string>): LineTotal {
  const quantity = parseDecimal(line.quantity);
  const price = parseDecimal(line.unitPrice);
  const discount = parseDecimal(line.discount || '0');
  const percent = percents.get(line.ivaRateCode);
  if (quantity === null || price === null || discount === null || percent === undefined)
    return null;
  // quantity × price at 12 places, less the discount at the same scale, rounded to cents.
  const gross = quantity * price - discount * TEN ** BigInt(SCALE);
  if (gross < 0n) return null;
  const base = toCents(gross, SCALE * 2);
  const iva = divide(base * parseDecimal(percent)!, 100n * TEN ** BigInt(SCALE));
  return { base, iva };
}

export type FormTotals = {
  // By rate code, in the order lines first use it.
  groups: { rateCode: string; percent: string; base: bigint; iva: bigint }[];
  subtotal: bigint;
  discount: bigint;
  total: bigint;
  // Some line can't be computed yet (a field is empty or wrong).
  incomplete: boolean;
};

export function formTotals(lines: TotalsLine[], percents: Map<string, string>): FormTotals {
  const groups = new Map<string, FormTotals['groups'][number]>();
  let subtotal = 0n;
  let discount = 0n;
  let incomplete = false;
  for (const line of lines) {
    const amounts = lineTotal(line, percents);
    if (!amounts) {
      incomplete = true;
      continue;
    }
    subtotal += amounts.base;
    discount += toCents(parseDecimal(line.discount || '0')!, SCALE);
    const group = groups.get(line.ivaRateCode) ?? {
      rateCode: line.ivaRateCode,
      percent: percents.get(line.ivaRateCode)!,
      base: 0n,
      iva: 0n,
    };
    group.base += amounts.base;
    group.iva += amounts.iva;
    groups.set(line.ivaRateCode, group);
  }
  const list = [...groups.values()];
  return {
    groups: list,
    subtotal,
    discount,
    total: list.reduce((sum, group) => sum + group.iva, subtotal),
    incomplete,
  };
}
