import { Dec, money, type DecValue } from '../kernel';
import { IVA_TAX_CODE, ivaPercent } from './catalogues';

export type LineInput = {
  quantity: DecValue;
  unitPrice: DecValue;
  discount: DecValue;
  ivaRateCode: string;
};

export type LineAmounts = { base: Dec; ivaPercent: Dec; iva: Dec };

// ADR-012: each line's base and tax are rounded to cents on their own, and the document
// sums those rounded values, so its totals always equal what its lines show.
export function lineAmounts(line: LineInput): LineAmounts {
  const base = money(new Dec(line.quantity).mul(line.unitPrice).sub(line.discount));
  if (base.isNegative()) throw new Error('A discount can not exceed the line amount');
  const percent = ivaPercent(line.ivaRateCode);
  return { base, ivaPercent: percent, iva: money(base.mul(percent).div(100)) };
}

export type TaxTotal = { taxCode: string; rateCode: string; percent: Dec; base: Dec; value: Dec };

export type DocumentTotals = {
  subtotal: Dec;
  discount: Dec;
  taxes: TaxTotal[];
  total: Dec;
};

// totalConImpuestos groups by tax and rate code, in first-seen order.
export function documentTotals(lines: LineInput[]): DocumentTotals {
  const taxes = new Map<string, TaxTotal>();
  let subtotal = new Dec(0);
  let discount = new Dec(0);
  for (const line of lines) {
    const amounts = lineAmounts(line);
    subtotal = subtotal.add(amounts.base);
    discount = discount.add(money(line.discount));
    const group = taxes.get(line.ivaRateCode) ?? {
      taxCode: IVA_TAX_CODE,
      rateCode: line.ivaRateCode,
      percent: amounts.ivaPercent,
      base: new Dec(0),
      value: new Dec(0),
    };
    group.base = group.base.add(amounts.base);
    group.value = group.value.add(amounts.iva);
    taxes.set(line.ivaRateCode, group);
  }
  const taxList = [...taxes.values()];
  const total = taxList.reduce((sum, tax) => sum.add(tax.value), subtotal);
  return { subtotal, discount, taxes: taxList, total };
}
