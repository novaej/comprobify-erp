import { keepFields, PAYPHONE_APPROVED, type PayphoneGateway } from '../billing';

// For tests: answers as Payphone's confirm does, per transaction id, in memory (ADR-033).
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
