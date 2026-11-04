import { describe, expect, it } from 'vitest';
import { Dec, money } from '../kernel';
import { documentTotals, lineAmounts, SELECTABLE_IVA_RATES, SRI_IVA_RATES } from './index';

// ADR-012: decimals, half-up rounding, and totals that add up to the lines.
describe('money', () => {
  it('rounds half up to cents and never through a float', () => {
    expect(money('2.675').toFixed(2)).toBe('2.68');
    expect(money('0.125').toFixed(2)).toBe('0.13');
    // 0.1 + 0.2 is 0.30000000000000004 as floats.
    expect(new Dec('0.1').add('0.2').toFixed(2)).toBe('0.30');
  });
});

describe('SRI totals', () => {
  it('rounds each line, then sums the rounded lines', () => {
    const line = lineAmounts({
      quantity: '3',
      unitPrice: '0.333333',
      discount: '0',
      ivaRateCode: '4',
    });
    expect(line.base.toFixed(2)).toBe('1.00');
    expect(line.iva.toFixed(2)).toBe('0.15');
  });

  it('groups taxes by rate and totals subtotal plus IVA', () => {
    const totals = documentTotals([
      { quantity: '2', unitPrice: '10.005', discount: '0.01', ivaRateCode: '4' },
      { quantity: '1', unitPrice: '4.99', discount: '0', ivaRateCode: '0' },
      { quantity: '1.5', unitPrice: '3.10', discount: '0', ivaRateCode: '4' },
    ]);
    // 20.01 - 0.01 = 20.00 and 4.65 at 15%; 4.99 at 0%.
    expect(totals.subtotal.toFixed(2)).toBe('29.64');
    expect(totals.discount.toFixed(2)).toBe('0.01');
    expect(
      totals.taxes.map((tax) => [tax.rateCode, tax.base.toFixed(2), tax.value.toFixed(2)]),
    ).toEqual([
      ['4', '24.65', '3.70'],
      ['0', '4.99', '0.00'],
    ]);
    expect(totals.total.toFixed(2)).toBe('33.34');
  });

  it('refuses a discount larger than the line, and an unknown rate', () => {
    expect(() =>
      lineAmounts({ quantity: '1', unitPrice: '1', discount: '2', ivaRateCode: '4' }),
    ).toThrow();
    expect(() =>
      lineAmounts({ quantity: '1', unitPrice: '1', discount: '0', ivaRateCode: '9' }),
    ).toThrow();
  });

  it('offers only today’s IVA rates, and keeps the historical ones readable', () => {
    expect(SELECTABLE_IVA_RATES).toEqual(['0', '4', '5', '6', '7']);
    expect(SRI_IVA_RATES.map((rate) => rate.code)).toContain('2');
  });
});
