import { describe, expect, it } from 'vitest';
import { sampleFactura, sampleNotaCredito } from '../testing';
import { buildFactura } from './factura';
import { buildNotaCredito } from './nota-credito';
import { validateXml } from './xsd';

describe('the nota de crédito builder', () => {
  it('builds a credit note the XSD 1.1.0 accepts', async () => {
    const { xml } = buildNotaCredito(sampleNotaCredito());
    await expect(validateXml(xml, '04')).resolves.toEqual({ valid: true });
    expect(xml).toContain('<notaCredito id="comprobante" version="1.1.0">');
    expect(xml).toContain('<codDoc>04</codDoc>');
  });

  it('writes what it modifies, as the original prints it, and why', () => {
    const { xml } = buildNotaCredito(sampleNotaCredito());
    expect(xml).toContain(
      '<codDocModificado>01</codDocModificado><numDocModificado>001-001-000000001</numDocModificado>' +
        '<fechaEmisionDocSustento>03/11/2026</fechaEmisionDocSustento>',
    );
    expect(xml).toContain('<motivo>Devolución de mercadería</motivo></infoNotaCredito>');
  });

  it('uses the credit note names for a line and leaves out what it has no place for', () => {
    const { xml } = buildNotaCredito(sampleNotaCredito());
    expect(xml).toContain('<detalle><codigoInterno>SRV-001</codigoInterno>');
    expect(xml).toContain('<codigoAdicional>AUX-1</codigoAdicional><descripcion>Consultoría');
    for (const absent of [
      'codigoPrincipal',
      'unidadMedida',
      '<pagos>',
      'propina',
      'importeTotal',
    ]) {
      expect(xml).not.toContain(absent);
    }
    // Nor does it carry the buyer's address: infoNotaCredito has no element for it.
    expect(xml).not.toContain('direccionComprador');
  });

  it('rounds like the factura and credits the total with taxes', () => {
    const credit = buildNotaCredito(sampleNotaCredito());
    // 40.123456 → 40.12; IVA 15 % = 6.02 (ADR-012).
    expect(credit.totals.subtotal.toFixed(2)).toBe('40.12');
    expect(credit.totals.total.toFixed(2)).toBe('46.14');
    expect(credit.xml).toContain('<totalSinImpuestos>40.12</totalSinImpuestos>');
    expect(credit.xml).toContain('<valorModificacion>46.14</valorModificacion>');
    // The same line on the invoice rounds to the same base.
    const invoiceLine = sampleFactura().lines[0]!;
    const invoice = buildFactura(
      sampleFactura({ lines: [{ ...invoiceLine, quantity: '1', discount: '0' }] }),
    );
    expect(invoice.totals.subtotal.toFixed(2)).toBe('40.12');
  });

  it('keeps the header the factura has: legends, resolutions and the provider', async () => {
    const input = sampleNotaCredito();
    const { xml } = buildNotaCredito({
      ...input,
      issuer: { ...input.issuer, taxRegime: 'RIMPE_NEGOCIO_POPULAR' },
    });
    expect(xml).toContain('<agenteRetencion>1</agenteRetencion>');
    expect(xml).toContain(
      '<contribuyenteRimpe>CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE</contribuyenteRimpe>',
    );
    expect(xml).toContain('<campoAdicional nombre="RUC Proveedor">1712345678001</campoAdicional>');
    await expect(validateXml(xml, '04')).resolves.toEqual({ valid: true });
  });

  it('is refused by the XSD when the original is not numbered like one', async () => {
    const input = sampleNotaCredito();
    const { xml } = buildNotaCredito({
      ...input,
      modified: { ...input.modified, number: '1-1-1' },
    });
    await expect(validateXml(xml, '04')).resolves.toMatchObject({ valid: false });
  });
});
