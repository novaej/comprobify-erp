import { documentTotals, SRI_IVA_RATES } from '@comprobify/core';
import { describe, expect, it } from 'vitest';
import { formatCents, formTotals, lineTotal } from './invoice-totals';

const percents = new Map(SRI_IVA_RATES.map((rate) => [rate.code, rate.percent]));
const rates = ['0', '4', '5', '6', '7'];

// A seeded generator, so a failure repeats.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

const decimal = (next: () => number, max: number, places: number) =>
  (next() * max).toFixed(Math.floor(next() * (places + 1)));

describe('the invoice form’s totals (ADR-012)', () => {
  it('match core’s documentTotals to the cent, line by line and in total', () => {
    const next = random(42);
    for (let run = 0; run < 500; run++) {
      const lines = Array.from({ length: 1 + Math.floor(next() * 6) }, () => {
        const quantity = decimal(next, 50, 6) === '0' ? '1' : decimal(next, 50, 6);
        const unitPrice = decimal(next, 2000, 6);
        const gross = Number(quantity) * Number(unitPrice);
        return {
          quantity: Number(quantity) === 0 ? '1' : quantity,
          unitPrice,
          discount: next() < 0.5 ? '0' : (gross * next() * 0.5).toFixed(2),
          ivaRateCode: rates[Math.floor(next() * rates.length)]!,
        };
      });
      const core = documentTotals(lines);
      const form = formTotals(lines, percents);
      expect(form.incomplete).toBe(false);
      expect(formatCents(form.subtotal)).toBe(core.subtotal.toFixed(2));
      expect(formatCents(form.discount)).toBe(core.discount.toFixed(2));
      expect(formatCents(form.total)).toBe(core.total.toFixed(2));
      expect(form.groups.map((g) => [g.rateCode, formatCents(g.base), formatCents(g.iva)])).toEqual(
        core.taxes.map((t) => [t.rateCode, t.base.toFixed(2), t.value.toFixed(2)]),
      );
    }
  });

  it('rounds half-up at the cent, and leaves out what can’t be computed yet', () => {
    // 2.5 × 40.123456 − 0.31 = 99.99864 → 100.00; IVA 15 % = 15.00.
    const line = lineTotal(
      { quantity: '2.5', unitPrice: '40.123456', discount: '0.31', ivaRateCode: '4' },
      percents,
    );
    expect(line && [formatCents(line.base), formatCents(line.iva)]).toEqual(['100.00', '15.00']);
    // A decimal comma reads as the point.
    expect(
      formatCents(
        lineTotal({ quantity: '2', unitPrice: '10,50', discount: '', ivaRateCode: '0' }, percents)!
          .base,
      ),
    ).toBe('21.00');
    // 0.005 rounds up.
    expect(
      formatCents(
        lineTotal({ quantity: '1', unitPrice: '0.005', discount: '', ivaRateCode: '0' }, percents)!
          .base,
      ),
    ).toBe('0.01');
    const totals = formTotals(
      [
        { quantity: '', unitPrice: '10', discount: '', ivaRateCode: '4' },
        { quantity: '1', unitPrice: '1', discount: '5', ivaRateCode: '4' },
      ],
      percents,
    );
    expect(totals).toMatchObject({ incomplete: true, total: 0n });
  });
});
