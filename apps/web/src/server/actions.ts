import 'server-only';
import { isDomainError } from '@comprobify/core';

export type ActionState = { error?: string; done?: boolean };

// Expected failures become a code the form shows; anything else reaches the error boundary.
export async function toActionState(fn: () => Promise<void>): Promise<ActionState> {
  try {
    await fn();
    return { done: true };
  } catch (error) {
    if (isDomainError(error)) return { error: error.code };
    // By name: zod's class is bundled more than once too (see isDomainError).
    if (error instanceof Error && error.name === 'ZodError') return { error: 'INVALID_INPUT' };
    throw error;
  }
}
