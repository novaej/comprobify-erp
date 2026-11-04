import type { TAX_REGIMES } from '@comprobify/db';
import { Dec, money, toSriAmount, toSriPrecise } from '../kernel';
import { IVA_TAX_CODE } from './catalogues';
import { documentTotals, lineAmounts, type DocumentTotals } from './totals';
import { element, optional, XML_DECLARATION } from './xml';

export const FACTURA_VERSION = '2.1.0';

// Anexo 22. The factura XSD 2.1.0 only accepts the first; see ADR-013.
export const RIMPE_LEGENDS: Record<(typeof TAX_REGIMES)[number], string | null> = {
  GENERAL: null,
  RIMPE_EMPRENDEDOR: 'CONTRIBUYENTE RÉGIMEN RIMPE',
  RIMPE_NEGOCIO_POPULAR: 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE',
};

export type NameValue = { name: string; value: string };

export type FacturaInput = {
  ambiente: '1' | '2';
  accessKey: string;
  establishment: string;
  issuePoint: string;
  sequential: number;
  issueDate: string;
  issuer: {
    ruc: string;
    legalName: string;
    tradeName: string | null;
    mainAddress: string;
    branchAddress: string;
    requiredAccounting: boolean;
    specialTaxpayerResolution: string | null;
    withholdingAgentResolution: string | null;
    taxRegime: (typeof TAX_REGIMES)[number];
  };
  buyer: {
    idType: string;
    identification: string;
    name: string;
    address: string | null;
    email: string | null;
  };
  lines: {
    code: string;
    auxiliaryCode: string | null;
    name: string;
    unit: string | null;
    quantity: string;
    unitPrice: string;
    discount: string;
    ivaRateCode: string;
    additionalDetails: NameValue[];
  }[];
  payments: { method: string; amount: string; term: number | null; termUnit: string | null }[];
  additionalInfo: NameValue[];
  // "RUC Proveedor": the software provider, as NAC-DGERCGC26-00000027 asks.
  providerRuc: string | null;
};

const ddmmyyyy = (date: string) => date.split('-').reverse().join('/');
const field = ({ name, value }: NameValue) => element('campoAdicional', value, { nombre: name });

// The elements in the XSD's order (SRI rule 13). Totals come from the same rounding
// as the stored document (ADR-012).
export function buildFactura(input: FacturaInput): { xml: string; totals: DocumentTotals } {
  const { issuer, buyer } = input;
  const totals = documentTotals(input.lines);

  const infoTributaria = element('infoTributaria', [
    element('ambiente', input.ambiente),
    element('tipoEmision', '1'),
    element('razonSocial', issuer.legalName),
    optional('nombreComercial', issuer.tradeName),
    element('ruc', issuer.ruc),
    element('claveAcceso', input.accessKey),
    element('codDoc', '01'),
    element('estab', input.establishment),
    element('ptoEmi', input.issuePoint),
    element('secuencial', String(input.sequential).padStart(9, '0')),
    element('dirMatriz', issuer.mainAddress),
    optional('agenteRetencion', issuer.withholdingAgentResolution),
    optional('contribuyenteRimpe', RIMPE_LEGENDS[issuer.taxRegime]),
  ]);

  const infoFactura = element('infoFactura', [
    element('fechaEmision', ddmmyyyy(input.issueDate)),
    element('dirEstablecimiento', issuer.branchAddress),
    optional('contribuyenteEspecial', issuer.specialTaxpayerResolution),
    element('obligadoContabilidad', issuer.requiredAccounting ? 'SI' : 'NO'),
    element('tipoIdentificacionComprador', buyer.idType),
    element('razonSocialComprador', buyer.name),
    element('identificacionComprador', buyer.identification),
    optional('direccionComprador', buyer.address),
    element('totalSinImpuestos', toSriAmount(totals.subtotal)),
    element('totalDescuento', toSriAmount(totals.discount)),
    element(
      'totalConImpuestos',
      totals.taxes.map((tax) =>
        element('totalImpuesto', [
          element('codigo', tax.taxCode),
          element('codigoPorcentaje', tax.rateCode),
          element('baseImponible', toSriAmount(tax.base)),
          element('valor', toSriAmount(tax.value)),
        ]),
      ),
    ),
    element('propina', '0.00'),
    element('importeTotal', toSriAmount(totals.total)),
    element('moneda', 'DOLAR'),
    element(
      'pagos',
      input.payments.map((payment) =>
        element('pago', [
          element('formaPago', payment.method),
          element('total', payment.amount),
          payment.term === null ? undefined : element('plazo', String(payment.term)),
          optional('unidadTiempo', payment.termUnit),
        ]),
      ),
    ),
  ]);

  const detalles = element(
    'detalles',
    input.lines.map((line) => {
      const amounts = lineAmounts(line);
      return element('detalle', [
        element('codigoPrincipal', line.code),
        optional('codigoAuxiliar', line.auxiliaryCode),
        element('descripcion', line.name),
        optional('unidadMedida', line.unit),
        element('cantidad', toSriPrecise(new Dec(line.quantity))),
        element('precioUnitario', toSriPrecise(new Dec(line.unitPrice))),
        element('descuento', toSriAmount(money(line.discount))),
        element('precioTotalSinImpuesto', toSriAmount(amounts.base)),
        // Between precioTotalSinImpuesto and impuestos, or the XSD refuses it.
        line.additionalDetails.length > 0
          ? element(
              'detallesAdicionales',
              line.additionalDetails.map((detail) =>
                element('detAdicional', [], { nombre: detail.name, valor: detail.value }),
              ),
            )
          : undefined,
        element('impuestos', [
          element('impuesto', [
            element('codigo', IVA_TAX_CODE),
            element('codigoPorcentaje', line.ivaRateCode),
            element('tarifa', amounts.ivaPercent.toString()),
            element('baseImponible', toSriAmount(amounts.base)),
            element('valor', toSriAmount(amounts.iva)),
          ]),
        ]),
      ]);
    }),
  );

  const fields = [
    ...(buyer.email ? [{ name: 'Email', value: buyer.email }] : []),
    ...input.additionalInfo,
    ...(input.providerRuc ? [{ name: 'RUC Proveedor', value: input.providerRuc }] : []),
  ];
  const infoAdicional = fields.length > 0 ? element('infoAdicional', fields.map(field)) : undefined;

  const factura = element('factura', [infoTributaria, infoFactura, detalles, infoAdicional], {
    id: 'comprobante',
    version: FACTURA_VERSION,
  });
  return { xml: `${XML_DECLARATION}\n${factura}`, totals };
}
