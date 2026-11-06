import type { NotaCreditoInput } from '../sri';
import { sampleFactura } from './factura';

// A credit note against the sample factura: one line returned, using the optional elements.
export const sampleNotaCredito = (overrides: Partial<NotaCreditoInput> = {}): NotaCreditoInput => {
  const invoice = sampleFactura();
  return {
    ambiente: '1',
    accessKey: '1011202604179000000100110010010000000021234567811',
    establishment: '001',
    issuePoint: '001',
    sequential: 2,
    issueDate: '2026-11-10',
    issuer: invoice.issuer,
    buyer: invoice.buyer,
    modified: { documentType: '01', number: '001-001-000000001', issueDate: '2026-11-03' },
    reason: 'Devolución de mercadería',
    lines: [
      {
        code: 'SRV-001',
        auxiliaryCode: 'AUX-1',
        name: 'Consultoría',
        quantity: '1',
        unitPrice: '40.123456',
        discount: '0',
        ivaRateCode: '4',
        additionalDetails: [{ name: 'Lote', value: 'A1' }],
      },
    ],
    additionalInfo: [{ name: 'Orden', value: 'OC-77' }],
    providerRuc: '1712345678001',
    ...overrides,
  };
};
