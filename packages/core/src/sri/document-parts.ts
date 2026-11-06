import type { TAX_REGIMES } from '@comprobify/db';
import { toSriAmount } from '../kernel';
import { IVA_TAX_CODE } from './catalogues';
import type { DocumentTotals, LineAmounts } from './totals';
import { element, optional } from './xml';

// What every SRI document's XML shares: the header, the tax blocks and the additional
// information. Each document's builder keeps its own element order (SRI rule 13).

// Anexo 22. The published XSDs accept only the first; xsd.ts widens them (ADR-013).
export const RIMPE_LEGENDS: Record<(typeof TAX_REGIMES)[number], string | null> = {
  GENERAL: null,
  RIMPE_EMPRENDEDOR: 'CONTRIBUYENTE RÉGIMEN RIMPE',
  RIMPE_NEGOCIO_POPULAR: 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE',
};

export type NameValue = { name: string; value: string };

export type IssuerInput = {
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

export type BuyerInput = {
  idType: string;
  identification: string;
  name: string;
  address: string | null;
  email: string | null;
};

export type HeaderInput = {
  ambiente: '1' | '2';
  accessKey: string;
  establishment: string;
  issuePoint: string;
  sequential: number;
  issuer: IssuerInput;
};

export const ddmmyyyy = (date: string) => date.split('-').reverse().join('/');

export const infoTributaria = (input: HeaderInput, documentType: string) =>
  element('infoTributaria', [
    element('ambiente', input.ambiente),
    element('tipoEmision', '1'),
    element('razonSocial', input.issuer.legalName),
    optional('nombreComercial', input.issuer.tradeName),
    element('ruc', input.issuer.ruc),
    element('claveAcceso', input.accessKey),
    element('codDoc', documentType),
    element('estab', input.establishment),
    element('ptoEmi', input.issuePoint),
    element('secuencial', String(input.sequential).padStart(9, '0')),
    element('dirMatriz', input.issuer.mainAddress),
    optional('agenteRetencion', input.issuer.withholdingAgentResolution),
    optional('contribuyenteRimpe', RIMPE_LEGENDS[input.issuer.taxRegime]),
  ]);

export const totalConImpuestos = (totals: DocumentTotals) =>
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
  );

export const lineTaxes = (ivaRateCode: string, amounts: LineAmounts) =>
  element('impuestos', [
    element('impuesto', [
      element('codigo', IVA_TAX_CODE),
      element('codigoPorcentaje', ivaRateCode),
      element('tarifa', amounts.ivaPercent.toString()),
      element('baseImponible', toSriAmount(amounts.base)),
      element('valor', toSriAmount(amounts.iva)),
    ]),
  ]);

export const detallesAdicionales = (details: NameValue[]) =>
  details.length > 0
    ? element(
        'detallesAdicionales',
        details.map((detail) =>
          element('detAdicional', [], { nombre: detail.name, valor: detail.value }),
        ),
      )
    : undefined;

const field = ({ name, value }: NameValue) => element('campoAdicional', value, { nombre: name });

// The buyer's email first, then the document's own, then "RUC Proveedor" (Anexo 26).
export function infoAdicional(
  buyer: BuyerInput,
  additionalInfo: NameValue[],
  providerRuc: string | null,
) {
  const fields = [
    ...(buyer.email ? [{ name: 'Email', value: buyer.email }] : []),
    ...additionalInfo,
    ...(providerRuc ? [{ name: 'RUC Proveedor', value: providerRuc }] : []),
  ];
  return fields.length > 0 ? element('infoAdicional', fields.map(field)) : undefined;
}
