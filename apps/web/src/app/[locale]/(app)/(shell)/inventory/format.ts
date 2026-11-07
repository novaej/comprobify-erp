// Quantities keep up to six decimals and drop the trailing zeros, from the decimal string.
export const quantityFormat = (locale: string) =>
  new Intl.NumberFormat(locale === 'en' ? 'en' : 'es-EC', { maximumFractionDigits: 6 });
