import { Dec, toSriPrecise } from '../kernel';
import {
  ddmmyyyy,
  detallesAdicionales,
  infoTributaria,
  type HeaderInput,
  type NameValue,
} from './document-parts';
import { element, optional, XML_DECLARATION } from './xml';

export const GUIA_REMISION_VERSION = '1.1.0';

// tipoIdentificacionTransportista: 04 RUC, 05 cédula, 06 pasaporte, 07 consumidor final,
// 08 identificación del exterior.
export const CARRIER_ID_TYPES = ['04', '05', '06', '07', '08'] as const;

export type GuiaRemisionInput = HeaderInput & {
  // Where the goods leave from.
  departureAddress: string;
  carrier: {
    idType: string;
    identification: string;
    name: string;
    // RISE, when the carrier is in that regime.
    rise: string | null;
  };
  // ISO dates. The transport starts on or after the day SRI receives the guía, and ends on
  // or after it starts (SRI error 82).
  transportStart: string;
  transportEnd: string;
  plate: string;
  recipients: {
    identification: string;
    name: string;
    address: string;
    reason: string;
    customsDocument: string | null;
    destinationEstablishment: string | null;
    route: string | null;
    // The document that supports the move, usually the invoice.
    support: {
      documentType: string;
      number: string;
      authorization: string | null;
      issueDate: string;
    } | null;
    lines: {
      code: string | null;
      auxiliaryCode: string | null;
      name: string;
      quantity: string;
      additionalDetails: NameValue[];
    }[];
  }[];
  additionalInfo: NameValue[];
  providerRuc: string | null;
};

// SRI refuses a guía whose transport starts before the day it is sent (error 82). Returns
// what is wrong, or null.
export function guiaDateProblem(
  issueDate: string,
  start: string,
  end: string,
): 'START_BEFORE_ISSUE' | 'END_BEFORE_START' | null {
  if (start < issueDate) return 'START_BEFORE_ISSUE';
  if (end < start) return 'END_BEFORE_START';
  return null;
}

// The elements in the XSD 1.1.0's order (SRI rule 13). The guía moves goods and states no
// money, so it has no totals and no taxes.
export function buildGuiaRemision(input: GuiaRemisionInput): { xml: string } {
  const { issuer, carrier } = input;
  const info = element('infoGuiaRemision', [
    element('dirEstablecimiento', issuer.branchAddress),
    element('dirPartida', input.departureAddress),
    element('razonSocialTransportista', carrier.name),
    element('tipoIdentificacionTransportista', carrier.idType),
    element('rucTransportista', carrier.identification),
    optional('rise', carrier.rise),
    element('obligadoContabilidad', issuer.requiredAccounting ? 'SI' : 'NO'),
    optional('contribuyenteEspecial', issuer.specialTaxpayerResolution),
    element('fechaIniTransporte', ddmmyyyy(input.transportStart)),
    element('fechaFinTransporte', ddmmyyyy(input.transportEnd)),
    element('placa', input.plate),
  ]);

  const destinatarios = element(
    'destinatarios',
    input.recipients.map((recipient) =>
      element('destinatario', [
        element('identificacionDestinatario', recipient.identification),
        element('razonSocialDestinatario', recipient.name),
        element('dirDestinatario', recipient.address),
        element('motivoTraslado', recipient.reason),
        optional('docAduaneroUnico', recipient.customsDocument),
        optional('codEstabDestino', recipient.destinationEstablishment),
        optional('ruta', recipient.route),
        optional('codDocSustento', recipient.support?.documentType),
        optional('numDocSustento', recipient.support?.number),
        optional('numAutDocSustento', recipient.support?.authorization),
        optional(
          'fechaEmisionDocSustento',
          recipient.support ? ddmmyyyy(recipient.support.issueDate) : null,
        ),
        element(
          'detalles',
          recipient.lines.map((line) =>
            element('detalle', [
              optional('codigoInterno', line.code),
              optional('codigoAdicional', line.auxiliaryCode),
              element('descripcion', line.name),
              element('cantidad', toSriPrecise(new Dec(line.quantity))),
              detallesAdicionales(line.additionalDetails),
            ]),
          ),
        ),
      ]),
    ),
  );

  const fields = [
    ...input.additionalInfo,
    ...(input.providerRuc ? [{ name: 'RUC Proveedor', value: input.providerRuc }] : []),
  ];
  const adicional =
    fields.length > 0
      ? element(
          'infoAdicional',
          fields.map(({ name, value }) => element('campoAdicional', value, { nombre: name })),
        )
      : undefined;

  const guia = element(
    'guiaRemision',
    [infoTributaria(input, '06'), info, destinatarios, adicional],
    { id: 'comprobante', version: GUIA_REMISION_VERSION },
  );
  return { xml: `${XML_DECLARATION}\n${guia}` };
}
