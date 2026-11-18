import { DOMParser } from '@xmldom/xmldom';

// ADR-049: an authorized factura read back into the rows a document keeps, for one issued
// elsewhere. Every value stays the string SRI authorized.

export type ReadFactura = {
  ambiente: string;
  ruc: string;
  accessKey: string;
  documentType: string;
  series: string;
  sequential: number;
  // ISO, from fechaEmision.
  issueDate: string;
  buyer: { idType: string; identification: string; name: string; address: string | null };
  lines: {
    code: string;
    auxiliaryCode: string | null;
    name: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    ivaRateCode: string;
    base: string;
    iva: string;
    additionalDetails: { name: string; value: string }[];
  }[];
  taxes: { taxCode: string; rateCode: string; base: string; value: string }[];
  subtotal: string;
  discount: string;
  total: string;
  payments: { method: string; amount: string; term: number | null; termUnit: string | null }[];
  additionalInfo: { name: string; value: string }[];
};

const IVA = '2';

const elements = (parent: Element | undefined): Element[] =>
  parent
    ? Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1)
    : [];
const child = (parent: Element | undefined, name: string) =>
  elements(parent).find((node) => node.localName === name);
const all = (parent: Element | undefined, name: string) =>
  elements(parent).filter((node) => node.localName === name);
const text = (parent: Element | undefined, name: string): string | null => {
  const value = child(parent, name)?.textContent?.trim();
  return value ? value : null;
};
const required = (parent: Element | undefined, name: string): string => {
  const value = text(parent, name);
  if (value === null) throw new Error(`The factura has no ${name}`);
  return value;
};
const pairs = (parent: Element | undefined, list: string, item: string) =>
  all(child(parent, list), item).map((node) => ({
    name: node.getAttribute('nombre') ?? '',
    // detAdicional holds it in an attribute, campoAdicional as its text.
    value: node.hasAttribute('valor')
      ? (node.getAttribute('valor') ?? '')
      : (node.textContent?.trim() ?? ''),
  }));

export function readFactura(xml: string): ReadFactura {
  const root = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
  if (root?.localName !== 'factura') throw new Error('Not a factura');
  const info = child(root, 'infoTributaria');
  const invoice = child(root, 'infoFactura');
  return {
    ambiente: required(info, 'ambiente'),
    ruc: required(info, 'ruc'),
    accessKey: required(info, 'claveAcceso'),
    documentType: required(info, 'codDoc'),
    series: `${required(info, 'estab')}${required(info, 'ptoEmi')}`,
    sequential: Number(required(info, 'secuencial')),
    issueDate: required(invoice, 'fechaEmision').split('/').reverse().join('-'),
    buyer: {
      idType: required(invoice, 'tipoIdentificacionComprador'),
      identification: required(invoice, 'identificacionComprador'),
      name: required(invoice, 'razonSocialComprador'),
      address: text(invoice, 'direccionComprador'),
    },
    lines: all(child(root, 'detalles'), 'detalle').map((line) => {
      const taxes = all(child(line, 'impuestos'), 'impuesto');
      const iva = taxes.find((tax) => text(tax, 'codigo') === IVA);
      if (!iva || taxes.length !== 1) throw new Error('A line without exactly one IVA tax');
      return {
        code: required(line, 'codigoPrincipal'),
        auxiliaryCode: text(line, 'codigoAuxiliar'),
        name: required(line, 'descripcion'),
        quantity: required(line, 'cantidad'),
        unitPrice: required(line, 'precioUnitario'),
        discount: required(line, 'descuento'),
        ivaRateCode: required(iva, 'codigoPorcentaje'),
        base: required(iva, 'baseImponible'),
        iva: required(iva, 'valor'),
        additionalDetails: pairs(line, 'detallesAdicionales', 'detAdicional'),
      };
    }),
    taxes: all(child(invoice, 'totalConImpuestos'), 'totalImpuesto').map((tax) => ({
      taxCode: required(tax, 'codigo'),
      rateCode: required(tax, 'codigoPorcentaje'),
      base: required(tax, 'baseImponible'),
      value: required(tax, 'valor'),
    })),
    subtotal: required(invoice, 'totalSinImpuestos'),
    discount: required(invoice, 'totalDescuento'),
    total: required(invoice, 'importeTotal'),
    payments: all(child(invoice, 'pagos'), 'pago').map((payment) => {
      const term = text(payment, 'plazo');
      return {
        method: required(payment, 'formaPago'),
        amount: required(payment, 'total'),
        term: term === null ? null : Number(term),
        termUnit: text(payment, 'unidadTiempo'),
      };
    }),
    additionalInfo: pairs(root, 'infoAdicional', 'campoAdicional'),
  };
}
