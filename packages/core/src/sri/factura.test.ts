import { describe, expect, it } from 'vitest';
import { sampleFactura } from '../testing';
import { buildFactura } from './factura';
import { validateXml, widenRimpe } from './xsd';
import factura210 from './xsd/factura-2.1.0';

describe('the factura builder', () => {
  it('builds a factura the XSD 2.1.0 accepts, with totals from the rounded lines', async () => {
    const { xml, totals } = buildFactura(sampleFactura());
    await expect(validateXml(xml, '01')).resolves.toEqual({ valid: true });
    // 2.5 × 40.123456 − 0.31 = 99.99864 → 100.00; IVA 15 %.
    expect(totals.subtotal.toFixed(2)).toBe('112.00');
    expect(totals.total.toFixed(2)).toBe('127.00');
    expect(xml).toContain('<secuencial>000000001</secuencial>');
    expect(xml).toContain('<fechaEmision>10/11/2026</fechaEmision>');
    expect(xml).toContain(
      '<cantidad>2.500000</cantidad><precioUnitario>40.123456</precioUnitario>',
    );
    expect(xml).toContain('<campoAdicional nombre="RUC Proveedor">1712345678001</campoAdicional>');
  });

  it('writes the canonical form: escapes, double quotes, no self-closing tags', () => {
    const { xml } = buildFactura(sampleFactura());
    expect(xml).toContain('<razonSocial>Alfa &amp; Omega S.A.</razonSocial>');
    expect(xml).toContain('<nombreComercial>Alfa &lt;Tienda&gt;</nombreComercial>');
    expect(xml).toContain('<razonSocialComprador>María "Mary" López</razonSocialComprador>');
    expect(xml).toContain('<detAdicional nombre="Lote" valor="A1"></detAdicional>');
    expect(xml).not.toMatch(/\/>/);
    expect(xml).toMatch(
      /^<\?xml version="1.0" encoding="UTF-8"\?>\n<factura id="comprobante" version="2.1.0">/,
    );
  });

  it('keeps the XSD order: detallesAdicionales between the line total and its taxes', () => {
    const { xml } = buildFactura(sampleFactura());
    const order = ['precioTotalSinImpuesto', 'detallesAdicionales', 'impuestos'].map((name) =>
      xml.indexOf(`<${name}>`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(xml.indexOf('<agenteRetencion>')).toBeLessThan(xml.indexOf('</infoTributaria>'));
  });

  it('leaves out what is empty, and an invalid one fails with the XSD’s reason', async () => {
    const minimal = buildFactura(
      sampleFactura({
        issuer: { ...sampleFactura().issuer, tradeName: null, specialTaxpayerResolution: null },
        buyer: {
          idType: '07',
          identification: '9999999999999',
          name: 'CONSUMIDOR FINAL',
          address: null,
          email: null,
        },
        additionalInfo: [],
        providerRuc: null,
      }),
    );
    expect(minimal.xml).not.toContain('nombreComercial');
    expect(minimal.xml).not.toContain('infoAdicional');
    await expect(validateXml(minimal.xml, '01')).resolves.toEqual({ valid: true });

    const result = await validateXml(minimal.xml.replace('<ambiente>1', '<ambiente>3'), '01');
    expect(result).toMatchObject({ valid: false });
    expect(result.valid || result.errors.join('\n')).toMatch(/ambiente/);
  });

  it('prints both RIMPE legends of Anexo 22, which the widened XSD accepts (ADR-013)', async () => {
    const issuer = sampleFactura().issuer;
    const emprendedor = buildFactura(
      sampleFactura({ issuer: { ...issuer, taxRegime: 'RIMPE_EMPRENDEDOR' } }),
    );
    expect(emprendedor.xml).toContain(
      '<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe></infoTributaria>',
    );
    await expect(validateXml(emprendedor.xml, '01')).resolves.toEqual({ valid: true });
    const popular = buildFactura(
      sampleFactura({ issuer: { ...issuer, taxRegime: 'RIMPE_NEGOCIO_POPULAR' } }),
    );
    expect(popular.xml).toContain(
      '<contribuyenteRimpe>CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE</contribuyenteRimpe>',
    );
    await expect(validateXml(popular.xml, '01')).resolves.toEqual({ valid: true });
    // Still a closed list: any other text fails.
    const other = popular.xml.replace('NEGOCIO POPULAR - RÉGIMEN RIMPE', 'RÉGIMEN GENERAL');
    await expect(validateXml(other, '01')).resolves.toMatchObject({ valid: false });
  });

  it('refuses to widen an XSD whose RIMPE pattern changed', () => {
    expect(() => widenRimpe(factura210.replace('RÉGIMEN RIMPE"', 'RIMPE"'))).toThrow();
  });
});
