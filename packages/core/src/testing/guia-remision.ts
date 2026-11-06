import type { GuiaRemisionInput } from '../sri';
import { sampleFactura } from './factura';

// A guía for the sample factura's goods, to one recipient, using the optional elements.
export const sampleGuiaRemision = (
  overrides: Partial<GuiaRemisionInput> = {},
): GuiaRemisionInput => {
  const invoice = sampleFactura();
  return {
    ambiente: '1',
    accessKey: '1011202606179000000100110010010000000031234567811',
    establishment: '001',
    issuePoint: '001',
    sequential: 3,
    issuer: invoice.issuer,
    departureAddress: 'Av. Amazonas N24-03, Quito',
    carrier: {
      idType: '04',
      identification: '1790012345001',
      name: 'Transportes Andes S.A.',
      rise: null,
    },
    transportStart: '2026-11-10',
    transportEnd: '2026-11-11',
    plate: 'PCQ-1234',
    recipients: [
      {
        identification: '1710034065',
        name: 'María "Mary" López',
        address: 'Av. 6 de Diciembre y Colón, Quito',
        reason: 'Venta',
        customsDocument: null,
        destinationEstablishment: '001',
        route: 'Quito - Guayaquil',
        support: {
          documentType: '01',
          number: '001-001-000000001',
          authorization: null,
          issueDate: '2026-11-03',
        },
        lines: [
          {
            code: 'SRV-001',
            auxiliaryCode: 'AUX-1',
            name: 'Café molido',
            quantity: '2.5',
            additionalDetails: [{ name: 'Lote', value: 'A1' }],
          },
        ],
      },
    ],
    additionalInfo: [{ name: 'Orden', value: 'OC-77' }],
    providerRuc: '1712345678001',
    ...overrides,
  };
};
