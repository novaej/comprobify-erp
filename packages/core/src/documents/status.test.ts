import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, DOCUMENT_STATUSES, DOCUMENT_TRANSITIONS } from './index';

// FR-DOC-3 and the SRI rules it encodes.
describe('document status machine', () => {
  it('sends a signed document, and corrects a returned or rejected one as the same row', () => {
    expect(canTransition('SIGNED', 'PENDING_SEND')).toBe(true);
    expect(canTransition('RETURNED', 'SIGNED')).toBe(true);
    expect(canTransition('NOT_AUTHORIZED', 'SIGNED')).toBe(true);
  });

  it('never lets a returned document be authorized, nor an authorized one change but by voiding', () => {
    expect(canTransition('RETURNED', 'AUTHORIZED')).toBe(false);
    expect(DOCUMENT_TRANSITIONS.AUTHORIZED).toEqual(['VOIDED']);
    expect(DOCUMENT_TRANSITIONS.VOIDED).toEqual([]);
    expect(() => assertTransition('VOIDED', 'SIGNED')).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
  });

  it('names only known statuses in the transitions', () => {
    for (const targets of Object.values(DOCUMENT_TRANSITIONS))
      for (const target of targets) expect(DOCUMENT_STATUSES).toContain(target);
  });
});
