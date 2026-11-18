import { describe, expect, it } from 'vitest';
import { sampleFactura } from '../testing';
import { buildFactura } from './factura';
import { readFactura } from './read-factura';

// ADR-049: what the builder writes, the reader gets back as the rows a document keeps.
describe('reading a factura back', () => {
  it('reads what the builder wrote, as written', () => {
    const input = sampleFactura();
    const { xml, totals } = buildFactura(input);
    const read = readFactura(xml);
    expect(read).toMatchObject({
      ruc: input.issuer.ruc,
      documentType: '01',
      sequential: 1,
      issueDate: '2026-11-10',
      buyer: { idType: input.buyer.idType, name: input.buyer.name },
      subtotal: totals.subtotal.toFixed(2),
      total: totals.total.toFixed(2),
    });
    expect(read.accessKey).toMatch(/^[0-9]{49}$/);
    expect(read.series).toMatch(/^[0-9]{6}$/);
    expect(read.lines[0]).toMatchObject({ quantity: '2.500000', unitPrice: '40.123456' });
    expect(read.lines[0]!.additionalDetails).toContainEqual({ name: 'Lote', value: 'A1' });
    expect(read.taxes.map((tax) => tax.base)).toEqual(
      totals.taxes.map((tax) => tax.base.toFixed(2)),
    );
    expect(read.additionalInfo).toContainEqual({ name: 'RUC Proveedor', value: '1712345678001' });
    expect(read.payments.length).toBe(input.payments.length);
  });

  it('refuses what is not a factura', () => {
    expect(() => readFactura('<notaCredito></notaCredito>')).toThrow('Not a factura');
  });
});
