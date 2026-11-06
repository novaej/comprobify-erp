import { describe, expect, it } from 'vitest';
import { parseP12 } from '../certificates';
import { ecuadorDateTimeDisplay } from '../kernel';
import { createTestP12, sampleFactura, sampleNotaCredito } from '../testing';
import { buildNotaCredito } from './nota-credito';
import { authorizedXmlFile } from './authorized-file';
import { buildFactura } from './factura';
import { signXml } from './signer';
import { rideData, totalRows } from './ride-data';
import { renderRide } from './ride-pdf';

const now = new Date('2026-11-10T15:00:00Z');
const certificate = parseP12(
  createTestP12({ notBefore: new Date('2026-01-01'), notAfter: new Date('2027-12-31') }),
  'secret',
  now,
);
const authorized = (overrides: Parameters<typeof sampleFactura>[0] = {}) =>
  signXml(buildFactura(sampleFactura(overrides)).xml, certificate, now);

describe('the RIDE (FR-DOC-10)', () => {
  it('reads everything from the authorized XML, as SRI authorized it', () => {
    const data = rideData(authorized());
    expect(data).toMatchObject({
      ruc: '1790000000001',
      legalName: 'Alfa & Omega S.A.',
      tradeName: 'Alfa <Tienda>',
      sequential: '000000001',
      issueDate: '10/11/2026',
      requiredAccounting: 'SI',
      withholdingAgent: '1',
      buyer: { name: 'María "Mary" López', identification: '1710034065' },
      total: '127.00',
    });
    expect(data.lines[0]).toMatchObject({
      quantity: '2.500000',
      total: '100.00',
      details: [{ name: 'Lote', value: 'A1' }],
    });
    expect(data.additionalInfo.map((field) => field.name)).toEqual([
      'Email',
      'Orden',
      'RUC Proveedor',
    ]);
  });

  it('prints the totals box from totalConImpuestos, keeping 0 %, no objeto and exento apart', () => {
    const rows = totalRows(rideData(authorized()));
    expect(rows.map((row) => `${row.label} ${row.value}`)).toEqual([
      'SUBTOTAL 15% 100.00',
      'SUBTOTAL 0% 12.00',
      'SUBTOTAL NO OBJETO DE IVA 0.00',
      'SUBTOTAL EXENTO DE IVA 0.00',
      'SUBTOTAL SIN IMPUESTOS 112.00',
      'TOTAL DESCUENTO 0.31',
      'ICE 0.00',
      'IVA 15% 15.00',
      'IRBPNR 0.00',
      'PROPINA 0.00',
      'VALOR TOTAL 127.00',
    ]);
  });

  it('renders an A4 PDF with the barcode, breaking long documents onto more pages', async () => {
    const extras = {
      authorizationNumber: sampleFactura().accessKey,
      authorizedAt: now,
      logo: null,
      compress: false,
    };
    const short = await renderRide(rideData(authorized()), extras);
    expect(short.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length;
    expect(pages(short)).toBe(1);
    // The barcode is an image on the page.
    expect(short.toString('latin1')).toMatch(/\/Subtype \/Image/);

    const line = sampleFactura().lines[1]!;
    const many = Array.from({ length: 80 }, (_, i) => ({ ...line, code: `L-${i}` }));
    const long = await renderRide(
      rideData(
        authorized({
          lines: many,
          payments: [{ method: '01', amount: '960.00', term: null, termUnit: null }],
        }),
      ),
      extras,
    );
    expect(pages(long)).toBeGreaterThan(1);
  });

  it('prints the authorization time in Quito, and wraps the XML the way SRI does', () => {
    expect(ecuadorDateTimeDisplay(new Date('2026-11-11T04:30:05Z'))).toBe('10/11/2026 23:30:05');
    const xml = authorized();
    const file = authorizedXmlFile({
      comprobante: xml,
      authorizationNumber: '123',
      authorizedAt: now,
      ambiente: '1',
    });
    expect(file).toContain('<estado>AUTORIZADO</estado>');
    expect(file).toContain('<fechaAutorizacion>2026-11-10T10:00:00-05:00</fechaAutorizacion>');
    expect(file).toContain(`<comprobante><![CDATA[${xml}]]></comprobante>`);
  });

  it('reads a nota de crédito: the document it modifies, the reason, no payments', async () => {
    const xml = signXml(buildNotaCredito(sampleNotaCredito()).xml, certificate, now);
    const data = rideData(xml);
    expect(data.documentType).toBe('04');
    expect(data.modification?.reason).toBeTruthy();
    expect(data.payments).toEqual([]);
    expect(data.total).toMatch(/^\d+\.\d{2}$/);
    const pdf = await renderRide(data, {
      authorizationNumber: sampleNotaCredito().accessKey,
      authorizedAt: now,
      logo: null,
      compress: false,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
  });
});
