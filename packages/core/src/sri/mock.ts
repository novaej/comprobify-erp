import { escapeText } from './xml';
import type { SriTransport } from './client';
import { first, parseXml, textOf, type SriMessage } from './soap';

// A stand-in for SRI that answers like it (Ficha sections 7 and 8), for tests and for
// local work with SRI_MOCK_MODE, which the env refuses in production. By default:
// a new key is RECIBIDA and then AUTORIZADO; a resend while processing is 70, after
// authorization 43; another key with an authorized number is 45. `queue` overrides
// the next answers of one service.

export type MockOutcome =
  | { kind: 'transport' }
  | { kind: 'http'; status: number }
  | { kind: 'garbage' }
  | { kind: 'returned'; code: string; message: string }
  | { kind: 'pending' }
  | { kind: 'notAuthorized'; code: string; message: string }
  | { kind: 'voided' };

type Service = 'reception' | 'authorization' | 'validity';
type Held = { xml: string; number: string; state: 'PROCESSING' | 'AUTHORIZED' | 'VOIDED' };

export type MockSri = {
  transport: SriTransport;
  queue: (service: Service, ...outcomes: MockOutcome[]) => void;
  // What SRI holds, by access key.
  held: ReadonlyMap<string, Readonly<Held>>;
  void: (accessKey: string) => void;
};

const soap = (body: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

const messages = (list: SriMessage[]) =>
  list.length === 0
    ? '<mensajes/>'
    : `<mensajes>${list
        .map(
          (m) =>
            `<mensaje><identificador>${m.identifier}</identificador><mensaje>${escapeText(m.message)}</mensaje>` +
            (m.additionalInfo
              ? `<informacionAdicional>${escapeText(m.additionalInfo)}</informacionAdicional>`
              : '') +
            `<tipo>${m.type ?? 'ERROR'}</tipo></mensaje>`,
        )
        .join('')}</mensajes>`;

const reception = (state: 'RECIBIDA' | 'DEVUELTA', key: string, list: SriMessage[] = []) =>
  soap(
    `<ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante><estado>${state}</estado>` +
      (list.length === 0
        ? '<comprobantes/>'
        : `<comprobantes><comprobante><claveAcceso>${key}</claveAcceso>${messages(list)}</comprobante></comprobantes>`) +
      '</RespuestaRecepcionComprobante></ns2:validarComprobanteResponse>',
  );

const authorization = (key: string, entries: string[]) =>
  soap(
    `<ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante>` +
      `<claveAccesoConsultada>${key}</claveAccesoConsultada><numeroComprobantes>${entries.length}</numeroComprobantes>` +
      `<autorizaciones>${entries.join('')}</autorizaciones></RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse>`,
  );

const validity = (key: string, inner: string) =>
  soap(
    `<ns2:consultarEstadoAutorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.consultas"><EstadoAutorizacionComprobante>` +
      `<claveAcceso>${key}</claveAcceso>${inner}</EstadoAutorizacionComprobante></ns2:consultarEstadoAutorizacionComprobanteResponse>`,
  );

const message = (identifier: string, text: string): SriMessage => ({
  identifier,
  message: text,
  additionalInfo: null,
  type: 'ERROR',
});

export function createMockSri(options: { now?: () => Date } = {}): MockSri {
  const now = options.now ?? (() => new Date());
  const held = new Map<string, Held>();
  const queues: Record<Service, MockOutcome[]> = { reception: [], authorization: [], validity: [] };

  const onReception = (xml: string, key: string, number: string, outcome?: MockOutcome) => {
    if (outcome?.kind === 'returned')
      return reception('DEVUELTA', key, [message(outcome.code, outcome.message)]);
    const known = held.get(key);
    if (known?.state === 'PROCESSING')
      return reception('DEVUELTA', key, [message('70', 'CLAVE DE ACCESO EN PROCESAMIENTO')]);
    if (known) return reception('DEVUELTA', key, [message('43', 'CLAVE ACCESO REGISTRADA')]);
    const taken = [...held.values()].some(
      (other) => other.number === number && other.state !== 'PROCESSING',
    );
    if (taken) return reception('DEVUELTA', key, [message('45', 'SECUENCIAL REGISTRADO')]);
    held.set(key, { xml, number, state: 'PROCESSING' });
    return reception('RECIBIDA', key);
  };

  const onAuthorization = (key: string, outcome?: MockOutcome) => {
    const known = held.get(key);
    if (!known || outcome?.kind === 'pending') return authorization(key, []);
    const date = `<fechaAutorizacion>${now().toISOString()}</fechaAutorizacion><ambiente>PRUEBAS</ambiente>`;
    if (outcome?.kind === 'notAuthorized') {
      // SRI forgets a rejected document: it may be corrected and sent again.
      held.delete(key);
      return authorization(key, [
        `<autorizacion><estado>NO AUTORIZADO</estado>${date}${messages([message(outcome.code, outcome.message)])}</autorizacion>`,
      ]);
    }
    if (known.state === 'PROCESSING') known.state = 'AUTHORIZED';
    return authorization(key, [
      `<autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>${key}</numeroAutorizacion>${date}` +
        `<comprobante><![CDATA[${known.xml}]]></comprobante>${messages([{ ...message('60', 'ESTE PROCESO FUE REALIZADO EN EL AMBIENTE DE PRUEBAS'), type: 'ADVERTENCIA' }])}</autorizacion>`,
    ]);
  };

  const onValidity = (key: string, outcome?: MockOutcome) => {
    const known = held.get(key);
    if (outcome?.kind === 'voided' && known) known.state = 'VOIDED';
    if (!known || known.state === 'PROCESSING')
      return validity(
        key,
        `<estadoConsulta>RECHAZADA</estadoConsulta>${messages([{ ...message('99', 'ERROR AL CONSULTAR DATOS DEL SERVICIO WEB'), additionalInfo: 'No existen datos para los parámetros ingresados' }])}`,
      );
    const state = known.state === 'VOIDED' ? 'ANULADO' : 'AUTORIZADO';
    return validity(key, `<mensajes/><estadoAutorizacion>${state}</estadoAutorizacion>`);
  };

  const answer = ({ url, body }: { url: string; body: string }) => {
    const service: Service = url.includes('Recepcion')
      ? 'reception'
      : url.includes('Autorizacion')
        ? 'authorization'
        : 'validity';
    const outcome = queues[service].shift();
    if (outcome?.kind === 'transport') throw new Error('mock SRI: connection reset');
    if (outcome?.kind === 'http') return { status: outcome.status, body: 'Service Unavailable' };
    if (outcome?.kind === 'garbage') return { status: 200, body: '<html>maintenance</html' };

    const request = parseXml(body);
    if (service === 'reception') {
      const xml = Buffer.from(textOf(request, 'xml') ?? '', 'base64').toString('utf8');
      const document = parseXml(xml);
      const info = first(document, 'infoTributaria');
      const key = textOf(info, 'claveAcceso') ?? '';
      const number = ['ruc', 'codDoc', 'estab', 'ptoEmi', 'secuencial']
        .map((tag) => textOf(info, tag))
        .join('-');
      return { status: 200, body: onReception(xml, key, number, outcome) };
    }
    if (service === 'authorization')
      return {
        status: 200,
        body: onAuthorization(textOf(request, 'claveAccesoComprobante') ?? '', outcome),
      };
    return { status: 200, body: onValidity(textOf(request, 'claveAcceso') ?? '', outcome) };
  };

  // A throw inside the executor rejects, as a dropped connection would.
  const transport: SriTransport = (request) => new Promise((resolve) => resolve(answer(request)));

  return {
    transport,
    queue: (service, ...outcomes) => queues[service].push(...outcomes),
    held,
    void: (accessKey) => {
      const known = held.get(accessKey);
      if (known) known.state = 'VOIDED';
    },
  };
}
