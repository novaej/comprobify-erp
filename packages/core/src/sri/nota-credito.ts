import { Dec, money, toSriAmount, toSriPrecise } from '../kernel';
import {
  ddmmyyyy,
  detallesAdicionales,
  infoAdicional,
  infoTributaria,
  lineTaxes,
  totalConImpuestos,
  type BuyerInput,
  type HeaderInput,
  type NameValue,
} from './document-parts';
import { documentTotals, lineAmounts, type DocumentTotals } from './totals';
import { element, optional, XML_DECLARATION } from './xml';

export const NOTA_CREDITO_VERSION = '1.1.0';

export type NotaCreditoInput = HeaderInput & {
  issueDate: string;
  buyer: BuyerInput;
  // The document it modifies, as that document's own number and issue date print.
  modified: { documentType: string; number: string; issueDate: string };
  reason: string;
  // What is returned or discounted: the same line fields as the invoice, without the unit.
  lines: {
    code: string;
    auxiliaryCode: string | null;
    name: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    ivaRateCode: string;
    additionalDetails: NameValue[];
  }[];
  additionalInfo: NameValue[];
  providerRuc: string | null;
};

// The elements in the XSD 1.1.0's order (SRI rule 13). The totals use the factura's rounding
// (ADR-012); valorModificacion is the credited total, taxes included.
export function buildNotaCredito(input: NotaCreditoInput): {
  xml: string;
  totals: DocumentTotals;
} {
  const { issuer, buyer, modified } = input;
  const totals = documentTotals(input.lines);

  const infoNotaCredito = element('infoNotaCredito', [
    element('fechaEmision', ddmmyyyy(input.issueDate)),
    element('dirEstablecimiento', issuer.branchAddress),
    element('tipoIdentificacionComprador', buyer.idType),
    element('razonSocialComprador', buyer.name),
    element('identificacionComprador', buyer.identification),
    optional('contribuyenteEspecial', issuer.specialTaxpayerResolution),
    element('obligadoContabilidad', issuer.requiredAccounting ? 'SI' : 'NO'),
    element('codDocModificado', modified.documentType),
    element('numDocModificado', modified.number),
    element('fechaEmisionDocSustento', ddmmyyyy(modified.issueDate)),
    element('totalSinImpuestos', toSriAmount(totals.subtotal)),
    element('valorModificacion', toSriAmount(totals.total)),
    element('moneda', 'DOLAR'),
    totalConImpuestos(totals),
    element('motivo', input.reason),
  ]);

  const detalles = element(
    'detalles',
    input.lines.map((line) => {
      const amounts = lineAmounts(line);
      return element('detalle', [
        element('codigoInterno', line.code),
        optional('codigoAdicional', line.auxiliaryCode),
        element('descripcion', line.name),
        element('cantidad', toSriPrecise(new Dec(line.quantity))),
        element('precioUnitario', toSriPrecise(new Dec(line.unitPrice))),
        element('descuento', toSriAmount(money(line.discount))),
        element('precioTotalSinImpuesto', toSriAmount(amounts.base)),
        detallesAdicionales(line.additionalDetails),
        lineTaxes(line.ivaRateCode, amounts),
      ]);
    }),
  );

  const adicional = infoAdicional(buyer, input.additionalInfo, input.providerRuc);
  const notaCredito = element(
    'notaCredito',
    [infoTributaria(input, '04'), infoNotaCredito, detalles, adicional],
    { id: 'comprobante', version: NOTA_CREDITO_VERSION },
  );
  return { xml: `${XML_DECLARATION}\n${notaCredito}`, totals };
}
