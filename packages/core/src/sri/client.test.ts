import { afterEach, describe, expect, it } from 'vitest';
import { createTestP12, sampleFactura, serveMockSri } from '../testing';
import { parseP12 } from '../certificates';
import {
  createSriClient,
  parseAuthorization,
  parseReception,
  parseValidity,
  SriTransportError,
} from './client';
import { buildFactura } from './factura';
import { createMockSri } from './mock';
import { signXml } from './signer';

// The Ficha Técnica v2.32's own examples, sections 7.2.3 and 8.2.3.
const FICHA_RETURNED = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante>
<estado>DEVUELTA</estado><comprobantes><comprobante>
<claveAcceso>1702201205176001321000110010030001000011234567816</claveAcceso><mensajes><mensaje>
<identificador>35</identificador><mensaje>DOCUMENTO INVÁLIDO</mensaje>
<informacionAdicional>Se encontró el siguiente error en la estructura del comprobante</informacionAdicional>
<tipo>ERROR</tipo></mensaje></mensajes></comprobante></comprobantes>
</RespuestaRecepcionComprobante></ns2:validarComprobanteResponse></soap:Body></soap:Envelope>`;

const FICHA_AUTHORIZED = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante>
<claveAccesoConsultada> 0503201201176001321000110010030009900641234567814 </claveAccesoConsultada>
<numeroComprobantes>1</numeroComprobantes><autorizaciones><autorizacion><estado>AUTORIZADO</estado>
<numeroAutorizacion>
    0503201201176001321000110010030009900641234567814
</numeroAutorizacion><fechaAutorizacion>2012-03-05T16:57:34.997-05:00</fechaAutorizacion>
<ambiente>PRUEBAS</ambiente><comprobante><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="1.0.0"></factura>]]>
</comprobante><mensajes><mensaje><identificador>60</identificador>
<mensaje>ESTE PROCESO FUE REALIZADO EN EL AMBIENTE DE PRUEBAS</mensaje><tipo>ADVERTENCIA</tipo></mensaje></mensajes>
</autorizacion></autorizaciones></RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse></soap:Body></soap:Envelope>`;

const FICHA_NOT_FOUND = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<ns2:consultarEstadoAutorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.consultas"><EstadoAutorizacionComprobante>
<estadoConsulta>RECHAZADA</estadoConsulta><claveAcceso>2111202401176001321000110010010000011171234567810</claveAcceso>
<mensajes><mensaje><identificador>99</identificador><mensaje>ERROR AL CONSULTAR DATOS DEL SERVICIO WEB</mensaje>
<informacionAdicional>No existen datos para los parámetros ingresados</informacionAdicional><tipo>ERROR</tipo></mensaje></mensajes>
</EstadoAutorizacionComprobante></ns2:consultarEstadoAutorizacionComprobanteResponse></soap:Body></soap:Envelope>`;

const now = new Date('2026-11-10T15:00:00Z');
const certificate = parseP12(
  createTestP12({ notBefore: new Date('2026-01-01'), notAfter: new Date('2027-12-31') }),
  'secret',
  now,
);
const signed = (sequential = 1, accessKey = sampleFactura().accessKey) =>
  signXml(buildFactura(sampleFactura({ sequential, accessKey })).xml, certificate, now);
const OTHER_KEY = '1011202601179000000100110010010000000021234567817';

describe('SRI responses', () => {
  it('reads the Ficha’s examples', () => {
    expect(parseReception(FICHA_RETURNED)).toMatchObject({
      status: 'RETURNED',
      messages: [{ identifier: '35', message: 'DOCUMENTO INVÁLIDO', type: 'ERROR' }],
    });
    const authorized = parseAuthorization(FICHA_AUTHORIZED);
    expect(authorized).toMatchObject({
      status: 'AUTHORIZED',
      authorizationNumber: '0503201201176001321000110010030009900641234567814',
      messages: [{ identifier: '60', type: 'ADVERTENCIA' }],
    });
    expect(authorized.status === 'AUTHORIZED' && authorized.authorizedAt.toISOString()).toBe(
      '2012-03-05T21:57:34.997Z',
    );
    expect(authorized.status === 'AUTHORIZED' && authorized.authorizationXml).toMatch(
      /^<\?xml version="1.0" encoding="UTF-8"\?>\n<factura id="comprobante"/,
    );
    expect(parseValidity(FICHA_NOT_FOUND)).toMatchObject({
      status: 'NOT_FOUND',
      messages: [{ identifier: '99' }],
    });
  });

  it('counts 43 and 70 as received, and keeps 45 returned (SRI rule 3)', () => {
    const returned = (code: string) =>
      FICHA_RETURNED.replace('<identificador>35', `<identificador>${code}`);
    expect(parseReception(returned('43')).status).toBe('RECEIVED');
    expect(parseReception(returned('70')).status).toBe('RECEIVED');
    expect(parseReception(returned('45')).status).toBe('RETURNED');
  });

  it('prefers the one AUTORIZADO among several answers, and reads no answer as pending', () => {
    const twice = FICHA_AUTHORIZED.replace(
      '<autorizaciones>',
      '<autorizaciones><autorizacion><estado>NO AUTORIZADO</estado><mensajes/></autorizacion>',
    );
    expect(parseAuthorization(twice).status).toBe('AUTHORIZED');
    const none = FICHA_AUTHORIZED.replace(
      /<numeroComprobantes>1[\s\S]*<\/autorizaciones>/,
      '<numeroComprobantes>0</numeroComprobantes><autorizaciones/>',
    );
    expect(parseAuthorization(none).status).toBe('PENDING');
  });
});

describe('the SRI client against the mock', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('sends, authorizes and checks validity over HTTP, the way SRI answers', async () => {
    const mock = createMockSri({ now: () => now });
    const server = await serveMockSri(mock);
    close = server.close;
    const client = createSriClient({ baseUrls: { '1': server.baseUrl } });
    const xml = signed();
    const key = sampleFactura().accessKey;

    await expect(client.validity(key, '1')).resolves.toMatchObject({ status: 'NOT_FOUND' });
    await expect(client.send(xml, '1')).resolves.toMatchObject({
      status: 'RECEIVED',
      messages: [],
    });
    // A resend while SRI processes it: 70, which still means SRI holds it.
    await expect(client.send(xml, '1')).resolves.toMatchObject({
      status: 'RECEIVED',
      messages: [{ identifier: '70' }],
    });
    const authorized = await client.authorization(key, '1');
    expect(authorized).toMatchObject({ status: 'AUTHORIZED', authorizationNumber: key });
    expect(authorized.status === 'AUTHORIZED' && authorized.authorizationXml).toBe(xml);
    await expect(client.send(xml, '1')).resolves.toMatchObject({
      messages: [{ identifier: '43' }],
    });
    await expect(client.validity(key, '1')).resolves.toMatchObject({ status: 'AUTHORIZED' });
    mock.void(key);
    await expect(client.validity(key, '1')).resolves.toMatchObject({ status: 'VOIDED' });

    // Another key for an authorized number: 45, returned.
    await expect(client.send(signed(1, OTHER_KEY), '1')).resolves.toMatchObject({
      status: 'RETURNED',
      messages: [{ identifier: '45' }],
    });
  });

  it('lets a rejected document be sent again, as SRI forgets it', async () => {
    const mock = createMockSri({ now: () => now });
    const client = createSriClient({ transport: mock.transport });
    const key = sampleFactura().accessKey;
    await client.send(signed(), '1');
    mock.queue(
      'authorization',
      { kind: 'pending' },
      { kind: 'notAuthorized', code: '46', message: 'RUC no existe' },
    );
    await expect(client.authorization(key, '1')).resolves.toMatchObject({ status: 'PENDING' });
    await expect(client.authorization(key, '1')).resolves.toMatchObject({
      status: 'NOT_AUTHORIZED',
      messages: [{ identifier: '46', message: 'RUC no existe' }],
    });
    await expect(client.send(signed(), '1')).resolves.toMatchObject({
      status: 'RECEIVED',
      messages: [],
    });
  });

  it('throws a transport error, and only that, for no connection, 5xx, junk and timeouts', async () => {
    const mock = createMockSri();
    const client = createSriClient({ transport: mock.transport });
    mock.queue(
      'reception',
      { kind: 'transport' },
      { kind: 'http', status: 503 },
      { kind: 'garbage' },
    );
    for (let i = 0; i < 3; i++)
      await expect(client.send(signed(), '1')).rejects.toBeInstanceOf(SriTransportError);
    mock.queue('reception', { kind: 'returned', code: '35', message: 'DOCUMENTO INVÁLIDO' });
    await expect(client.send(signed(), '1')).resolves.toMatchObject({ status: 'RETURNED' });

    const hanging = await serveMockSri('hang');
    close = hanging.close;
    const slow = createSriClient({ baseUrls: { '1': hanging.baseUrl }, timeoutMs: 200 });
    await expect(slow.authorization(sampleFactura().accessKey, '1')).rejects.toBeInstanceOf(
      SriTransportError,
    );
  });

  it('routes by the document’s ambiente: 1 to SRI test, 2 to production', async () => {
    const urls: string[] = [];
    const mock = createMockSri();
    const client = createSriClient({
      transport: (request) => {
        urls.push(request.url);
        return mock.transport(request);
      },
    });
    await client.validity(sampleFactura().accessKey, '1');
    await client.validity(sampleFactura().accessKey, '2');
    expect(urls).toEqual([
      'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante?wsdl',
      'https://cel.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante?wsdl',
    ]);
  });

  it('reads unknown keys as voided for the web in mock mode (ADR-014)', async () => {
    const web = createSriClient({ transport: createMockSri({ unknownKeys: 'VOIDED' }).transport });
    await expect(web.validity(sampleFactura().accessKey, '1')).resolves.toMatchObject({
      status: 'VOIDED',
    });
  });
});
