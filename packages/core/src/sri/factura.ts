import { Dec, money, toSriAmount, toSriPrecise } from '../kernel';
import {
  ddmmyyyy,
  detallesAdicionales,
  infoAdicional,
  infoTributaria,
  lineTaxes,
  RIMPE_LEGENDS,
  totalConImpuestos,
  type BuyerInput,
  type IssuerInput,
  type NameValue,
} from './document-parts';
import { documentTotals, lineAmounts, type DocumentTotals } from './totals';
import { element, optional, XML_DECLARATION } from './xml';

// Both are defined in document-parts.ts; the factura's names stay exported from here.
export { RIMPE_LEGENDS };
export type { NameValue };

export const FACTURA_VERSION = '2.1.0';

export type FacturaInput = {
  ambiente: '1' | '2';
  accessKey: string;
  establishment: string;
  issuePoint: string;
  sequential: number;
  issueDate: string;
  issuer: IssuerInput;
  buyer: BuyerInput;
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

// The elements in the XSD's order (SRI rule 13). Totals come from the same rounding
// as the stored document (ADR-012).
export function buildFactura(input: FacturaInput): { xml: string; totals: DocumentTotals } {
  const { issuer, buyer } = input;
  const totals = documentTotals(input.lines);

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
    totalConImpuestos(totals),
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
        detallesAdicionales(line.additionalDetails),
        lineTaxes(line.ivaRateCode, amounts),
      ]);
    }),
  );

  const adicional = infoAdicional(buyer, input.additionalInfo, input.providerRuc);

  const factura = element(
    'factura',
    [infoTributaria(input, '01'), infoFactura, detalles, adicional],
    {
      id: 'comprobante',
      version: FACTURA_VERSION,
    },
  );
  return { xml: `${XML_DECLARATION}\n${factura}`, totals };
}
