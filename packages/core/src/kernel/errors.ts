export type DomainErrorDetails = Record<string, unknown>;

// A global key, because Next bundles the same class more than once, so an
// error thrown by one copy fails `instanceof` against another.
const BRAND = Symbol.for('comprobify.DomainError');

// NFR-ARCH-6: `code` is a stable contract. Adapters map it to messages.
export class DomainError extends Error {
  override readonly name = 'DomainError';
  readonly [BRAND] = true;

  constructor(
    readonly code: string,
    message: string,
    readonly details?: DomainErrorDetails,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export const isDomainError = (error: unknown, code?: string): error is DomainError =>
  typeof error === 'object' &&
  error !== null &&
  BRAND in error &&
  (code === undefined || (error as DomainError).code === code);
