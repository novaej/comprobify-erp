import { DOMParser } from '@xmldom/xmldom';
import { escapeText } from './xml';

// The three SRI web services, as the Ficha Técnica v2.32 (sections 7 and 8) defines them.

export type SriMessage = {
  identifier: string;
  message: string;
  additionalInfo: string | null;
  type: string | null;
};

const envelope = (namespace: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="${namespace}">` +
  `<soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;

export const receptionEnvelope = (signedXml: string) =>
  envelope(
    'http://ec.gob.sri.ws.recepcion',
    `<ec:validarComprobante><xml>${Buffer.from(signedXml, 'utf8').toString('base64')}</xml></ec:validarComprobante>`,
  );

export const authorizationEnvelope = (accessKey: string) =>
  envelope(
    'http://ec.gob.sri.ws.autorizacion',
    `<ec:autorizacionComprobante><claveAccesoComprobante>${escapeText(accessKey)}</claveAccesoComprobante></ec:autorizacionComprobante>`,
  );

export const validityEnvelope = (accessKey: string) =>
  envelope(
    'http://ec.gob.sri.ws.consultas',
    `<ec:consultarEstadoAutorizacionComprobante><claveAcceso>${escapeText(accessKey)}</claveAcceso></ec:consultarEstadoAutorizacionComprobante>`,
  );

// Not SRI's answer at all: unparseable, or not the response we asked for.
export class SriResponseError extends Error {
  override readonly name = 'SriResponseError';
}

export function parseXml(text: string): Element {
  let failed: string | null = null;
  const document = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message) => (failed ??= String(message)),
      fatalError: (message) => (failed ??= String(message)),
    },
  }).parseFromString(text, 'text/xml');
  if (failed || !document.documentElement)
    throw new SriResponseError(`Unparseable SRI response: ${failed ?? 'empty'}`);
  return document.documentElement;
}

// SRI's responses use unprefixed local names under prefixed wrappers; match by local name.
export const children = (parent: Element, name: string): Element[] =>
  Array.from(parent.getElementsByTagName('*')).filter(
    (node): node is Element => node.localName === name,
  );

export const first = (parent: Element, name: string): Element | undefined =>
  children(parent, name)[0];

export const textOf = (parent: Element | undefined, name: string): string | null => {
  const node = parent ? first(parent, name) : undefined;
  const value = node?.textContent?.trim();
  return value ? value : null;
};

export function messagesOf(parent: Element): SriMessage[] {
  // <mensajes><mensaje><mensaje>…: only the outer ones carry an identificador.
  return children(parent, 'mensaje')
    .filter((node) => first(node, 'identificador'))
    .map((node) => ({
      identifier: textOf(node, 'identificador')!,
      message: textOf(node, 'mensaje') ?? '',
      additionalInfo: textOf(node, 'informacionAdicional'),
      type: textOf(node, 'tipo'),
    }));
}
