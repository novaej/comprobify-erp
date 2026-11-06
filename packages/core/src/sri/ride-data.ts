import { DOMParser } from '@xmldom/xmldom';
import { SRI_IVA_RATES } from './catalogues';

// FR-DOC-10: what a RIDE prints, read from the authorized XML only (SRI rule 15). Every
// value stays the string SRI authorized; nothing is recomputed.

export type RideLine = {
  code: string;
  auxiliaryCode: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  total: string;
  details: { name: string; value: string }[];
};

export type RideData = {
  ambiente: string;
  emissionType: string;
  legalName: string;
  tradeName: string | null;
  ruc: string;
  accessKey: string;
  documentType: string;
  establishment: string;
  issuePoint: string;
  sequential: string;
  mainAddress: string;
  branchAddress: string | null;
  specialTaxpayer: string | null;
  requiredAccounting: string | null;
  withholdingAgent: string | null;
  rimpe: string | null;
  issueDate: string;
  buyer: { idType: string; name: string; identification: string; address: string | null };
  lines: RideLine[];
  taxes: { code: string; rateCode: string; base: string; value: string }[];
  subtotal: string;
  discount: string;
  tip: string;
  total: string;
  payments: { method: string; total: string; term: string | null; termUnit: string | null }[];
  additionalInfo: { name: string; value: string }[];
  // A nota de crédito: the document it modifies and why. Null on a factura.
  modification: { number: string; issueDate: string; reason: string } | null;
  // A guía de remisión: the move itself. Null on the other types.
  transport: Transport | null;
};

// Dates are as the XML prints them in `RideData`, and ISO here, where a form reads them back.
export type Transport = {
  departureAddress: string;
  carrier: { idType: string; identification: string; name: string; rise: string | null };
  start: string;
  end: string;
  plate: string;
  recipients: {
    identification: string;
    name: string;
    address: string;
    reason: string;
    customsDocument: string | null;
    destinationEstablishment: string | null;
    route: string | null;
    support: { number: string; authorization: string | null; issueDate: string } | null;
    lines: {
      code: string | null;
      auxiliaryCode: string | null;
      name: string;
      quantity: string;
      additionalDetails: { name: string; value: string }[];
    }[];
  }[];
};

const isoDate = (value: string) => value.split('/').reverse().join('-');

const childElements = (parent: Element | undefined): Element[] =>
  parent
    ? Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1)
    : [];
const child = (parent: Element | undefined, name: string) =>
  childElements(parent).find((node) => node.localName === name);
const all = (parent: Element | undefined, name: string) =>
  childElements(parent).filter((node) => node.localName === name);
const text = (parent: Element | undefined, name: string): string | null => {
  const value = child(parent, name)?.textContent?.trim();
  return value ? value : null;
};
const required = (parent: Element | undefined, name: string): string => {
  const value = text(parent, name);
  if (value === null) throw new Error(`The authorized XML has no ${name}`);
  return value;
};

// A guía has no issue date element: SRI takes it from the access key's first eight digits.
function guideData(root: Element): RideData {
  const info = child(root, 'infoTributaria');
  const guide = child(root, 'infoGuiaRemision');
  const key = required(info, 'claveAcceso');
  const recipients = all(child(root, 'destinatarios'), 'destinatario').map((one) => {
    const supportNumber = text(one, 'numDocSustento');
    const supportDate = text(one, 'fechaEmisionDocSustento');
    return {
      identification: required(one, 'identificacionDestinatario'),
      name: required(one, 'razonSocialDestinatario'),
      address: required(one, 'dirDestinatario'),
      reason: required(one, 'motivoTraslado'),
      customsDocument: text(one, 'docAduaneroUnico'),
      destinationEstablishment: text(one, 'codEstabDestino'),
      route: text(one, 'ruta'),
      support:
        supportNumber && supportDate
          ? {
              number: supportNumber,
              authorization: text(one, 'numAutDocSustento'),
              issueDate: isoDate(supportDate),
            }
          : null,
      lines: all(child(one, 'detalles'), 'detalle').map((line) => ({
        code: text(line, 'codigoInterno'),
        auxiliaryCode: text(line, 'codigoAdicional'),
        name: required(line, 'descripcion'),
        quantity: required(line, 'cantidad'),
        additionalDetails: all(child(line, 'detallesAdicionales'), 'detAdicional').map(
          (detail) => ({
            name: detail.getAttribute('nombre') ?? '',
            value: detail.getAttribute('valor') ?? '',
          }),
        ),
      })),
    };
  });
  const first = recipients[0];
  return {
    ambiente: required(info, 'ambiente'),
    emissionType: required(info, 'tipoEmision'),
    legalName: required(info, 'razonSocial'),
    tradeName: text(info, 'nombreComercial'),
    ruc: required(info, 'ruc'),
    accessKey: key,
    documentType: required(info, 'codDoc'),
    establishment: required(info, 'estab'),
    issuePoint: required(info, 'ptoEmi'),
    sequential: required(info, 'secuencial'),
    mainAddress: required(info, 'dirMatriz'),
    branchAddress: text(guide, 'dirEstablecimiento'),
    specialTaxpayer: text(guide, 'contribuyenteEspecial'),
    requiredAccounting: text(guide, 'obligadoContabilidad'),
    withholdingAgent: text(info, 'agenteRetencion'),
    rimpe: text(info, 'contribuyenteRimpe'),
    issueDate: `${key.slice(0, 2)}/${key.slice(2, 4)}/${key.slice(4, 8)}`,
    buyer: {
      idType: '',
      name: first?.name ?? '',
      identification: first?.identification ?? '',
      address: first?.address ?? null,
    },
    lines: [],
    taxes: [],
    subtotal: '0.00',
    discount: '0.00',
    tip: '0.00',
    total: '0.00',
    payments: [],
    additionalInfo: all(child(root, 'infoAdicional'), 'campoAdicional').map((field) => ({
      name: field.getAttribute('nombre') ?? '',
      value: field.textContent?.trim() ?? '',
    })),
    modification: null,
    transport: {
      departureAddress: required(guide, 'dirPartida'),
      carrier: {
        idType: required(guide, 'tipoIdentificacionTransportista'),
        identification: required(guide, 'rucTransportista'),
        name: required(guide, 'razonSocialTransportista'),
        rise: text(guide, 'rise'),
      },
      start: isoDate(required(guide, 'fechaIniTransporte')),
      end: isoDate(required(guide, 'fechaFinTransporte')),
      plate: required(guide, 'placa'),
      recipients,
    },
  };
}

export function rideData(authorizedXml: string): RideData {
  const root = new DOMParser().parseFromString(authorizedXml, 'text/xml').documentElement;
  if (root?.localName === 'guiaRemision') return guideData(root);
  const credit = root?.localName === 'notaCredito';
  if (root?.localName !== 'factura' && !credit) throw new Error('Not a factura or nota de crédito');
  const info = child(root, 'infoTributaria');
  const invoice = child(root, credit ? 'infoNotaCredito' : 'infoFactura');
  return {
    ambiente: required(info, 'ambiente'),
    emissionType: required(info, 'tipoEmision'),
    legalName: required(info, 'razonSocial'),
    tradeName: text(info, 'nombreComercial'),
    ruc: required(info, 'ruc'),
    accessKey: required(info, 'claveAcceso'),
    documentType: required(info, 'codDoc'),
    establishment: required(info, 'estab'),
    issuePoint: required(info, 'ptoEmi'),
    sequential: required(info, 'secuencial'),
    mainAddress: required(info, 'dirMatriz'),
    branchAddress: text(invoice, 'dirEstablecimiento'),
    specialTaxpayer: text(invoice, 'contribuyenteEspecial'),
    requiredAccounting: text(invoice, 'obligadoContabilidad'),
    withholdingAgent: text(info, 'agenteRetencion'),
    rimpe: text(info, 'contribuyenteRimpe'),
    issueDate: required(invoice, 'fechaEmision'),
    buyer: {
      idType: required(invoice, 'tipoIdentificacionComprador'),
      name: required(invoice, 'razonSocialComprador'),
      identification: required(invoice, 'identificacionComprador'),
      address: text(invoice, 'direccionComprador'),
    },
    lines: all(child(root, 'detalles'), 'detalle').map((line) => ({
      code: text(line, 'codigoPrincipal') ?? text(line, 'codigoInterno') ?? '',
      auxiliaryCode: text(line, 'codigoAuxiliar') ?? text(line, 'codigoAdicional'),
      description: required(line, 'descripcion'),
      quantity: required(line, 'cantidad'),
      unitPrice: required(line, 'precioUnitario'),
      discount: required(line, 'descuento'),
      total: required(line, 'precioTotalSinImpuesto'),
      details: all(child(line, 'detallesAdicionales'), 'detAdicional').map((detail) => ({
        name: detail.getAttribute('nombre') ?? '',
        value: detail.getAttribute('valor') ?? '',
      })),
    })),
    taxes: all(child(invoice, 'totalConImpuestos'), 'totalImpuesto').map((tax) => ({
      code: required(tax, 'codigo'),
      rateCode: required(tax, 'codigoPorcentaje'),
      base: required(tax, 'baseImponible'),
      value: required(tax, 'valor'),
    })),
    subtotal: required(invoice, 'totalSinImpuestos'),
    // The nota de crédito XML has no totalDescuento: its lines' discounts add up to it.
    discount:
      text(invoice, 'totalDescuento') ??
      (
        all(child(root, 'detalles'), 'detalle').reduce(
          (sum, line) => sum + Math.round(Number(required(line, 'descuento')) * 100),
          0,
        ) / 100
      ).toFixed(2),
    tip: text(invoice, 'propina') ?? '0.00',
    total: credit ? required(invoice, 'valorModificacion') : required(invoice, 'importeTotal'),
    payments: all(child(invoice, 'pagos'), 'pago').map((payment) => ({
      method: required(payment, 'formaPago'),
      total: required(payment, 'total'),
      term: text(payment, 'plazo'),
      termUnit: text(payment, 'unidadTiempo'),
    })),
    modification: credit
      ? {
          number: required(invoice, 'numDocModificado'),
          issueDate: required(invoice, 'fechaEmisionDocSustento'),
          reason: required(invoice, 'motivo'),
        }
      : null,
    transport: null,
    additionalInfo: all(child(root, 'infoAdicional'), 'campoAdicional').map((field) => ({
      name: field.getAttribute('nombre') ?? '',
      value: field.textContent?.trim() ?? '',
    })),
  };
}

// The totals box, in SRI's RIDE order, from totalConImpuestos as authorized. A rate with
// no lines prints 0.00; 0 %, no objeto and exento are separate legal categories.
const IVA = '2';
const ZERO = '0';
const NO_OBJETO = '6';
const EXENTO = '7';

const percentOf = (rateCode: string) =>
  SRI_IVA_RATES.find((rate) => rate.code === rateCode)?.percent ?? '0';

export function totalRows(data: RideData): { label: string; value: string; strong?: boolean }[] {
  const iva = data.taxes.filter((tax) => tax.code === IVA);
  const sum = (rateCode: string) => iva.find((tax) => tax.rateCode === rateCode)?.base ?? '0.00';
  const taxed = iva.filter((tax) => ![ZERO, NO_OBJETO, EXENTO].includes(tax.rateCode));
  return [
    ...taxed.map((tax) => ({ label: `SUBTOTAL ${percentOf(tax.rateCode)}%`, value: tax.base })),
    { label: 'SUBTOTAL 0%', value: sum(ZERO) },
    { label: 'SUBTOTAL NO OBJETO DE IVA', value: sum(NO_OBJETO) },
    { label: 'SUBTOTAL EXENTO DE IVA', value: sum(EXENTO) },
    { label: 'SUBTOTAL SIN IMPUESTOS', value: data.subtotal },
    { label: 'TOTAL DESCUENTO', value: data.discount },
    { label: 'ICE', value: '0.00' },
    ...taxed.map((tax) => ({ label: `IVA ${percentOf(tax.rateCode)}%`, value: tax.value })),
    { label: 'IRBPNR', value: '0.00' },
    { label: 'PROPINA', value: data.tip },
    { label: 'VALOR TOTAL', value: data.total, strong: true },
  ];
}
