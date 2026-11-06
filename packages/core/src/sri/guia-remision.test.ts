import { describe, expect, it } from 'vitest';
import { sampleGuiaRemision } from '../testing';
import { buildGuiaRemision, guiaDateProblem } from './guia-remision';
import { validateXml } from './xsd';

describe('the guía de remisión builder', () => {
  it('builds a guía the XSD 1.1.0 accepts', async () => {
    const { xml } = buildGuiaRemision(sampleGuiaRemision());
    await expect(validateXml(xml, '06')).resolves.toEqual({ valid: true });
    expect(xml).toContain('<guiaRemision id="comprobante" version="1.1.0">');
    expect(xml).toContain('<codDoc>06</codDoc>');
  });

  it('writes the transport, the carrier and the plate in the XSD order', () => {
    const { xml } = buildGuiaRemision(sampleGuiaRemision());
    expect(xml).toContain(
      '<dirPartida>Av. Amazonas N24-03, Quito</dirPartida>' +
        '<razonSocialTransportista>Transportes Andes S.A.</razonSocialTransportista>' +
        '<tipoIdentificacionTransportista>04</tipoIdentificacionTransportista>' +
        '<rucTransportista>1790012345001</rucTransportista>' +
        '<obligadoContabilidad>SI</obligadoContabilidad>',
    );
    expect(xml).toContain(
      '<fechaIniTransporte>10/11/2026</fechaIniTransporte>' +
        '<fechaFinTransporte>11/11/2026</fechaFinTransporte><placa>PCQ-1234</placa>',
    );
  });

  it('writes each recipient with the document that supports the move, and its goods', () => {
    const { xml } = buildGuiaRemision(sampleGuiaRemision());
    expect(xml).toContain(
      '<codDocSustento>01</codDocSustento><numDocSustento>001-001-000000001</numDocSustento>' +
        '<fechaEmisionDocSustento>03/11/2026</fechaEmisionDocSustento><detalles>',
    );
    expect(xml).toContain('<cantidad>2.500000</cantidad>');
    // Goods carry no price, discount or tax.
    for (const absent of ['precioUnitario', 'impuestos', 'totalConImpuestos', 'infoFactura'])
      expect(xml).not.toContain(absent);
  });

  it('leaves out what a recipient without a supporting document has no place for', async () => {
    const input = sampleGuiaRemision();
    const { xml } = buildGuiaRemision({
      ...input,
      recipients: [
        { ...input.recipients[0]!, support: null, route: null, destinationEstablishment: null },
      ],
    });
    expect(xml).not.toContain('DocSustento');
    expect(xml).not.toContain('<ruta>');
    await expect(validateXml(xml, '06')).resolves.toEqual({ valid: true });
  });

  it('takes several recipients', async () => {
    const input = sampleGuiaRemision();
    const { xml } = buildGuiaRemision({
      ...input,
      recipients: [input.recipients[0]!, { ...input.recipients[0]!, name: 'Otro cliente' }],
    });
    expect(xml.match(/<destinatario>/g)).toHaveLength(2);
    await expect(validateXml(xml, '06')).resolves.toEqual({ valid: true });
  });

  it('is refused by the XSD for a plate that is too long', async () => {
    const { xml } = buildGuiaRemision(sampleGuiaRemision({ plate: 'P'.repeat(21) }));
    await expect(validateXml(xml, '06')).resolves.toMatchObject({ valid: false });
  });

  it('keeps the header the factura has, including the provider RUC', () => {
    const { xml } = buildGuiaRemision(sampleGuiaRemision());
    expect(xml).toContain('<campoAdicional nombre="RUC Proveedor">1712345678001</campoAdicional>');
    expect(xml).toContain('<agenteRetencion>1</agenteRetencion>');
  });
});

describe('the guía dates (SRI error 82)', () => {
  it('lets the transport start the day it is sent or later', () => {
    expect(guiaDateProblem('2026-11-10', '2026-11-10', '2026-11-10')).toBeNull();
    expect(guiaDateProblem('2026-11-10', '2026-11-12', '2026-11-13')).toBeNull();
  });
  it('refuses a start before the issue date and an end before the start', () => {
    expect(guiaDateProblem('2026-11-10', '2026-11-09', '2026-11-12')).toBe('START_BEFORE_ISSUE');
    expect(guiaDateProblem('2026-11-10', '2026-11-12', '2026-11-11')).toBe('END_BEFORE_START');
  });
});
