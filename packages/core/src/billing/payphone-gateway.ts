// FR-BILL-3 (ADR-033): Payphone's confirm call, the one that captures the money. Payphone
// reverses any charge not confirmed within 5 minutes.

export const PAYPHONE_APPROVED = 3;

// Payphone echoes the payer's email, phone and id. Nothing here needs them: keep money, status
// and card fields only, so a new personal field on their side is dropped by default.
const KEPT_FIELDS = [
  'transactionId',
  'clientTransactionId',
  'statusCode',
  'transactionStatus',
  'authorizationCode',
  'message',
  'messages',
  'errorCode',
  'errors',
  'amount',
  'amountWithTax',
  'amountWithoutTax',
  'tax',
  'service',
  'tip',
  'currency',
  'cardBrand',
  'cardType',
  'lastDigits',
  'storeName',
  'reference',
  'date',
  'transactionDate',
  'deferredCode',
  'deferredMessage',
  'deferredType',
  'regionalReference',
] as const;

export type ConfirmBody = Partial<{
  transactionId: number;
  statusCode: number;
  authorizationCode: string;
  amount: number;
  cardBrand: string;
  lastDigits: string;
  errorCode: number;
  message: string;
}> &
  Record<string, unknown>;

// An answer, whatever it says, or a transport failure: the charge's state is then unknown and
// must never be read as a decline, which would strand real money.
export type ConfirmResult =
  | { reached: true; httpStatus: number; body: ConfirmBody | null }
  | { reached: false; error: string };

export type PayphoneGateway = {
  // Never throws.
  confirm(input: { id: number; clientTxId: string }): Promise<ConfirmResult>;
};

export function keepFields(body: unknown): ConfirmBody | null {
  if (!body || typeof body !== 'object') return null;
  const kept: Record<string, unknown> = {};
  for (const key of KEPT_FIELDS)
    if ((body as Record<string, unknown>)[key] !== undefined)
      kept[key] = (body as Record<string, unknown>)[key];
  return kept;
}

export function createPayphoneGateway(options: {
  token: string;
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}): PayphoneGateway {
  const send = options.fetch ?? fetch;
  return {
    async confirm({ id, clientTxId }) {
      try {
        const response = await send(`${options.baseUrl}/api/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.token}`,
            'User-Agent': 'Comprobify/1.0',
          },
          body: JSON.stringify({ id, clientTxId }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        // JSON on success and on error alike; "not found" is a 404 with a body, a real answer.
        const text = await response.text().catch(() => '');
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }
        return { reached: true, httpStatus: response.status, body: keepFields(body) };
      } catch (error) {
        // Timeout, DNS, a reset connection: nothing was learned.
        return { reached: false, error: String(error).slice(0, 200) };
      }
    },
  };
}

// For tests and local runs: answers as Payphone does, per transaction id.
export type FakeCharge = {
  amount: number;
  statusCode?: number;
  cardBrand?: string;
  lastDigits?: string;
  // The next confirm calls that fail in transport before an answer.
  unreachable?: number;
};

export function createFakePayphone() {
  const charges = new Map<number, FakeCharge & { clientTxId: string }>();
  const calls: { id: number; clientTxId: string }[] = [];
  let nextId = 900_000;
  const gateway: PayphoneGateway = {
    confirm({ id, clientTxId }) {
      calls.push({ id, clientTxId });
      const charge = charges.get(id);
      if (charge && (charge.unreachable ?? 0) > 0) {
        charge.unreachable! -= 1;
        return Promise.resolve({ reached: false, error: 'timeout' });
      }
      if (!charge || charge.clientTxId !== clientTxId)
        return Promise.resolve({
          reached: true,
          httpStatus: 404,
          body: { errorCode: 20, message: 'Transacción no encontrada' },
        });
      return Promise.resolve({
        reached: true,
        httpStatus: 200,
        body: keepFields({
          transactionId: id,
          clientTransactionId: clientTxId,
          statusCode: charge.statusCode ?? PAYPHONE_APPROVED,
          amount: charge.amount,
          authorizationCode: 'W12345',
          cardBrand: charge.cardBrand ?? 'Visa Banco Pichincha Crédito',
          lastDigits: charge.lastDigits ?? '4242',
          // Personal data Payphone sends, which must never be kept.
          email: 'payer@example.com',
          phoneNumber: '0999999999',
          document: '1710034065',
        }),
      });
    },
  };
  return {
    gateway,
    calls,
    // The payer completes the widget: Payphone holds a charge and redirects with its id.
    pay(clientTxId: string, charge: FakeCharge): number {
      const id = nextId++;
      charges.set(id, { ...charge, clientTxId });
      return id;
    },
  };
}
