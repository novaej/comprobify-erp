import type { AMBIENTES } from '@comprobify/db';
import {
  authorizationEnvelope,
  children,
  first,
  messagesOf,
  parseXml,
  receptionEnvelope,
  SriResponseError,
  textOf,
  validityEnvelope,
  type SriMessage,
} from './soap';

type Ambiente = (typeof AMBIENTES)[number];

// PRD section 6, rule 1. Env can point either at another host, such as the mock.
export const SRI_BASE_URLS: Record<Ambiente, string> = {
  '1': 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws',
  '2': 'https://cel.sri.gob.ec/comprobantes-electronicos-ws',
};

const SERVICES = {
  reception: 'RecepcionComprobantesOffline',
  authorization: 'AutorizacionComprobantesOffline',
  validity: 'ConsultaComprobante',
} as const;

// Codes that mean SRI holds the document though the answer says DEVUELTA (SRI rule 3).
export const SRI_HOLDS_CODES = ['43', '70'] as const;
// The sequential is taken by another key: stop and alert, never re-issue (FR-DOC-6).
export const SRI_SEQUENTIAL_TAKEN = '45';

export type ReceptionResult = {
  // RECEIVED also covers DEVUELTA with 43 or 70.
  status: 'RECEIVED' | 'RETURNED';
  messages: SriMessage[];
  raw: string;
};

export type AuthorizationResult =
  | {
      status: 'AUTHORIZED';
      authorizationNumber: string;
      authorizedAt: Date;
      authorizationXml: string;
      messages: SriMessage[];
      raw: string;
    }
  | { status: 'NOT_AUTHORIZED'; messages: SriMessage[]; raw: string }
  | { status: 'PENDING'; messages: SriMessage[]; raw: string };

export type ValidityResult = {
  status: 'AUTHORIZED' | 'NOT_AUTHORIZED' | 'PENDING_VOID' | 'VOIDED' | 'NOT_FOUND';
  messages: SriMessage[];
  raw: string;
};

// What the HTTP layer returns. A thrown error is a transport failure.
export type SriTransport = ((request: {
  url: string;
  body: string;
  timeoutMs: number;
}) => Promise<{ status: number; body: string }>) & {
  // The mock sets 'mock'; anything else talks to SRI.
  source?: 'sri' | 'mock';
};

// The only error the send and authorize jobs retry (SRI rule: transport errors only):
// no connection, a timeout, a 5xx or anything that isn't SRI's answer.
export class SriTransportError extends Error {
  override readonly name = 'SriTransportError';
  // What came back, if anything: kept for support (sri_exchanges).
  readonly raw: string | null;
  readonly durationMs: number;
  readonly source: SriSource;
  readonly host: string | null;
  constructor(
    message: string,
    readonly httpStatus: number | null = null,
    options?: ErrorOptions & {
      raw?: string | null;
      durationMs?: number;
      source?: SriSource;
      host?: string | null;
    },
  ) {
    super(message, options);
    this.raw = options?.raw ?? null;
    this.durationMs = options?.durationMs ?? 0;
    this.source = options?.source ?? 'sri';
    this.host = options?.host ?? null;
  }
}

// Every answer also says how it came: for the record of each call (sri_exchanges).
// The mock answers in SRI's own format, so who answered is said, never guessed (ADR-014).
export type SriSource = 'sri' | 'mock';
export type CallFacts = { httpStatus: number; durationMs: number; source: SriSource; host: string };

export const fetchTransport: SriTransport = async ({ url, body, timeoutMs }) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: await response.text() };
};

export type SriClient = {
  send: (signedXml: string, ambiente: Ambiente) => Promise<ReceptionResult & CallFacts>;
  authorization: (
    accessKey: string,
    ambiente: Ambiente,
  ) => Promise<AuthorizationResult & CallFacts>;
  validity: (accessKey: string, ambiente: Ambiente) => Promise<ValidityResult & CallFacts>;
};

export type SriClientOptions = {
  // 'mock' when the transport is the mock SRI.
  source?: SriSource;
  baseUrls?: Partial<Record<Ambiente, string>>;
  timeoutMs?: number;
  transport?: SriTransport;
};

export function parseReception(raw: string): ReceptionResult {
  const answer = first(parseXml(raw), 'RespuestaRecepcionComprobante');
  const state = textOf(answer, 'estado');
  if (!answer || (state !== 'RECIBIDA' && state !== 'DEVUELTA'))
    throw new SriResponseError(`Unexpected reception state ${state ?? 'none'}`);
  const messages = messagesOf(answer);
  const held = messages.some((message) =>
    (SRI_HOLDS_CODES as readonly string[]).includes(message.identifier),
  );
  return { status: state === 'RECIBIDA' || held ? 'RECEIVED' : 'RETURNED', messages, raw };
}

// One key may have several NO AUTORIZADO answers and one AUTORIZADO (SRI rule 4).
export function parseAuthorization(raw: string): AuthorizationResult {
  const answer = first(parseXml(raw), 'RespuestaAutorizacionComprobante');
  if (!answer) throw new SriResponseError('Not an authorization response');
  const all = children(answer, 'autorizacion');
  const authorized = all.find((node) => textOf(node, 'estado') === 'AUTORIZADO');
  if (authorized) {
    const number = textOf(authorized, 'numeroAutorizacion');
    const date = textOf(authorized, 'fechaAutorizacion');
    const xml = textOf(authorized, 'comprobante');
    if (!number || !date || !xml || Number.isNaN(Date.parse(date)))
      throw new SriResponseError('An authorization without its number, date or document');
    return {
      status: 'AUTHORIZED',
      authorizationNumber: number,
      authorizedAt: new Date(date),
      authorizationXml: xml,
      messages: messagesOf(authorized),
      raw,
    };
  }
  const latest = all.at(-1);
  const state = latest ? textOf(latest, 'estado') : null;
  if (state === 'NO AUTORIZADO' || state === 'RECHAZADO')
    return { status: 'NOT_AUTHORIZED', messages: messagesOf(latest!), raw };
  // No answer yet, or EN PROCESO.
  return { status: 'PENDING', messages: latest ? messagesOf(latest) : [], raw };
}

const VALIDITY: Record<string, ValidityResult['status']> = {
  AUTORIZADO: 'AUTHORIZED',
  'NO AUTORIZADO': 'NOT_AUTHORIZED',
  'PENDIENTE DE ANULAR': 'PENDING_VOID',
  ANULADO: 'VOIDED',
};

export function parseValidity(raw: string): ValidityResult {
  const answer = first(parseXml(raw), 'EstadoAutorizacionComprobante');
  if (!answer) throw new SriResponseError('Not a validity response');
  const messages = messagesOf(answer);
  // RECHAZADA: not in SRI's records, or outside the dates it can check.
  if (textOf(answer, 'estadoConsulta') === 'RECHAZADA')
    return { status: 'NOT_FOUND', messages, raw };
  const state = textOf(answer, 'estadoAutorizacion');
  const status = state ? VALIDITY[state] : undefined;
  if (!status) throw new SriResponseError(`Unexpected validity state ${state ?? 'none'}`);
  return { status, messages, raw };
}

// One request per call: retries belong to the job calendar (FR-DOC-4), never here.
export function createSriClient(options: SriClientOptions = {}): SriClient {
  const transport = options.transport ?? fetchTransport;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const source = options.source ?? transport.source ?? 'sri';
  const baseUrls = { ...SRI_BASE_URLS, ...options.baseUrls };

  async function call<T>(
    service: keyof typeof SERVICES,
    ambiente: Ambiente,
    body: string,
    parse: (raw: string) => T,
  ): Promise<T & CallFacts> {
    const url = `${baseUrls[ambiente]}/${SERVICES[service]}?wsdl`;
    const host = new URL(url).host;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let response: { status: number; body: string };
    try {
      response = await transport({ url, body, timeoutMs });
    } catch (error) {
      throw new SriTransportError(`SRI ${service} unreachable`, null, {
        cause: error,
        durationMs: elapsed(),
        source,
        host,
      });
    }
    const durationMs = elapsed();
    if (response.status < 200 || response.status >= 300)
      throw new SriTransportError(
        `SRI ${service} answered HTTP ${response.status}`,
        response.status,
        { raw: response.body, durationMs, source, host },
      );
    try {
      return { ...parse(response.body), httpStatus: response.status, durationMs, source, host };
    } catch (error) {
      throw new SriTransportError(`SRI ${service} answer was not understood`, response.status, {
        cause: error,
        raw: response.body,
        durationMs,
        source,
        host,
      });
    }
  }

  return {
    send: (signedXml, ambiente) =>
      call('reception', ambiente, receptionEnvelope(signedXml), parseReception),
    authorization: (accessKey, ambiente) =>
      call('authorization', ambiente, authorizationEnvelope(accessKey), parseAuthorization),
    validity: (accessKey, ambiente) =>
      call('validity', ambiente, validityEnvelope(accessKey), parseValidity),
  };
}
