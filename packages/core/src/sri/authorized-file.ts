import { ecuadorDateTime } from '../kernel';
import { escapeText, XML_DECLARATION } from './xml';

// The XML a buyer gets and the download serves: SRI's <autorizacion> wrapping the document
// exactly as authorized, the form accounting systems import.
export function authorizedXmlFile(authorization: {
  comprobante: string;
  authorizationNumber: string;
  authorizedAt: Date;
  ambiente: string;
}): string {
  if (authorization.comprobante.includes(']]>')) throw new Error('Unexpected CDATA end');
  return (
    `${XML_DECLARATION}\n<autorizacion>` +
    '<estado>AUTORIZADO</estado>' +
    `<numeroAutorizacion>${escapeText(authorization.authorizationNumber)}</numeroAutorizacion>` +
    `<fechaAutorizacion>${ecuadorDateTime(authorization.authorizedAt)}</fechaAutorizacion>` +
    `<ambiente>${authorization.ambiente === '2' ? 'PRODUCCIÓN' : 'PRUEBAS'}</ambiente>` +
    `<comprobante><![CDATA[${authorization.comprobante}]]></comprobante>` +
    '</autorizacion>'
  );
}
