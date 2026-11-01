export type DomainErrorDetails = Record<string, unknown>;

// NFR-ARCH-6: `code` is a stable contract. Adapters map it to messages.
export class DomainError extends Error {
  override readonly name = 'DomainError';

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
  error instanceof DomainError && (code === undefined || error.code === code);
