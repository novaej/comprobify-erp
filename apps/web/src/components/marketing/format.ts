// Prices arrive as strings before IVA ("9.90"); whole dollars drop the cents.
export function money(amount: string, locale: string): string {
  const value = Number(amount);
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export const pick = (locale: string, row: { nameEs: string; nameEn: string }) =>
  locale === 'en' ? row.nameEn : row.nameEs;

// Highlighted on the pricing page when a plan with this key is sold.
export const POPULAR_PLAN = 'BUSINESS';
