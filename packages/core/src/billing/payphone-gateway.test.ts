import { describe, expect, it } from 'vitest';
import { cardAmounts } from './payphone';
import { createPayphoneGateway, keepFields } from './payphone-gateway';

// FR-BILL-3 (ADR-033).
describe('the Payphone client', () => {
  const gateway = (fetch: typeof globalThis.fetch) =>
    createPayphoneGateway({
      token: 't'.repeat(20),
      baseUrl: 'https://pp.test',
      timeoutMs: 1000,
      fetch,
    });

  it('sends the confirm with the token and keeps only allow-listed fields', async () => {
    let request: { url: string; init: RequestInit } | null = null;
    const result = await gateway((url, init) => {
      request = { url: url as string, init: init! };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            statusCode: 3,
            amount: 575,
            email: 'p@example.com',
            phoneNumber: '099',
          }),
          { status: 200 },
        ),
      );
    }).confirm({ id: 7, clientTxId: 'abc' });
    expect(request!.url).toBe('https://pp.test/api/confirm');
    expect((request!.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${'t'.repeat(20)}`,
    );
    expect(JSON.parse(request!.init.body as string)).toEqual({ id: 7, clientTxId: 'abc' });
    expect(result).toEqual({
      reached: true,
      httpStatus: 200,
      body: { statusCode: 3, amount: 575 },
    });
  });

  it('reads "not found" as an answer, and a dropped connection as nothing learned', async () => {
    await expect(
      gateway(() =>
        Promise.resolve(new Response(JSON.stringify({ errorCode: 20 }), { status: 404 })),
      ).confirm({ id: 1, clientTxId: 'x' }),
    ).resolves.toEqual({ reached: true, httpStatus: 404, body: { errorCode: 20 } });
    await expect(
      gateway(() => Promise.reject(new Error('ECONNRESET'))).confirm({ id: 1, clientTxId: 'x' }),
    ).resolves.toMatchObject({ reached: false });
    await expect(
      gateway(() => Promise.resolve(new Response('<html>', { status: 502 }))).confirm({
        id: 1,
        clientTxId: 'x',
      }),
    ).resolves.toEqual({ reached: true, httpStatus: 502, body: null });
  });

  it('drops anything that is not an object', () => {
    expect(keepFields('text')).toBeNull();
    expect(keepFields({ document: '1710034065', lastDigits: '4242' })).toEqual({
      lastDigits: '4242',
    });
  });
});

describe('card amounts', () => {
  it('derives the taxed part, so the parts always add up to the total', () => {
    expect(cardAmounts({ totalAmount: '11.39', ivaAmount: '1.49' })).toEqual({
      amount: 1139,
      tax: 149,
      amountWithTax: 990,
      amountWithoutTax: 0,
      service: 0,
      tip: 0,
    });
    expect(cardAmounts({ totalAmount: '401.35', ivaAmount: '52.35' }).amountWithTax).toBe(34900);
    expect(cardAmounts({ totalAmount: '0.9', ivaAmount: '0.1' })).toMatchObject({
      amount: 90,
      tax: 10,
    });
  });
});
