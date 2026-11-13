import 'server-only';
import { isDomainError } from '@comprobify/core';

// `path` is where a refused input went wrong (a form may name the field), never its value.
export type ActionState = { error?: string; done?: boolean; path?: (string | number)[] };

// Expected failures become a code the form shows; anything else reaches the error boundary.
export async function toActionState(fn: () => Promise<void>): Promise<ActionState> {
  try {
    await fn();
    return { done: true };
  } catch (error) {
    if (isDomainError(error)) return { error: error.code };
    // By name: zod's class is bundled more than once too (see isDomainError).
    if (error instanceof Error && error.name === 'ZodError') {
      const issues = (error as { issues?: { path?: PropertyKey[] }[] }).issues;
      const path = (issues?.[0]?.path ?? []).filter(
        (part): part is string | number => typeof part !== 'symbol',
      );
      return { error: 'INVALID_INPUT', path };
    }
    throw error;
  }
}
