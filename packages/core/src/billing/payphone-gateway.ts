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
