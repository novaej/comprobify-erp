import { describe, expect, it } from 'vitest';
import { itemView } from './status';

describe('the status of a batch item', () => {
  it('is the batch’s own until the invoice exists', () => {
    expect(itemView('QUEUED', null)).toBe('QUEUED');
    expect(itemView('CREATING', null)).toBe('CREATING');
    expect(itemView('FAILED', null)).toBe('FAILED');
  });

  it('follows SRI’s answer once it does', () => {
    expect(itemView('CREATED', 'SIGNED')).toBe('SENT');
    expect(itemView('CREATED', 'RECEIVED')).toBe('SENT');
    expect(itemView('CREATED', 'SEND_FAILED')).toBe('SENT');
    expect(itemView('CREATED', 'AUTHORIZED')).toBe('AUTHORIZED');
    expect(itemView('CREATED', 'VOIDED')).toBe('AUTHORIZED');
    expect(itemView('CREATED', 'NOT_AUTHORIZED')).toBe('FAILED');
    expect(itemView('CREATED', 'RETURNED')).toBe('FAILED');
  });
});
