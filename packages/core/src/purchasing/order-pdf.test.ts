import { describe, expect, it } from 'vitest';
import { renderPurchaseOrderPdf, type OrderPdfData } from './index';

const data = (lines = 2): OrderPdfData => ({
  number: 'OC-000007',
  orderDate: '2026-11-10',
  expectedDate: '2026-11-20',
  notes: 'Entregar por la puerta lateral.',
  test: true,
  company: {
    legalName: 'Alfa S.A.',
    tradeName: 'Café Alfa',
    ruc: '1790012345001',
    mainAddress: 'Quito',
  },
  logo: null,
  provider: {
    name: 'Distribuidora Andina S.A.',
    identification: '1790012345001',
    emails: ['compras@andina.ec'],
  },
  delivery: { warehouse: '001 Matriz', address: 'Bodega norte' },
  lines: Array.from({ length: lines }, (_, i) => ({
    code: `P-${i}`,
    name: 'Café en grano tostado, saco de 25 kg',
    unit: 'saco',
    quantity: '2.500000',
    unitCost: '40.000000',
    ivaLabel: 'IVA 15%',
    subtotal: '100.00',
  })),
  totals: {
    subtotal: '200.00',
    taxes: [{ label: 'IVA 15%', value: '30.00' }],
    total: '230.00',
  },
  compress: false,
});

const pages = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length;

// FR-PUR-3.
describe('the purchase order PDF', () => {
  it('renders an A4 page, and breaks a long order onto more', async () => {
    const short = await renderPurchaseOrderPdf(data());
    expect(short.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(short)).toBe(1);
    expect(pages(await renderPurchaseOrderPdf(data(90)))).toBeGreaterThan(1);
  });
});
