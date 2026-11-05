import {
  AUDIT_ACTIONS,
  DOCUMENT_EVENT_TYPES,
  DOCUMENT_STATUSES,
  SRI_DOCUMENT_TYPES,
  SRI_ID_TYPES,
  SRI_IVA_RATES,
  SRI_PAYMENT_METHODS,
  SRI_TERM_UNITS,
} from '@comprobify/core';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';

function keys(messages: object, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? keys(value as object, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

// CLAUDE.md rule 18: Spanish default, English secondary, same keys.
describe('message files', () => {
  it('have the same keys', () => {
    expect(keys(en).sort()).toEqual(keys(es).sort());
  });

  it('have no empty strings', () => {
    const empty = (messages: object) =>
      keys(messages).filter((key) => {
        const value = key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages);
        return typeof value !== 'string' || value.trim() === '';
      });
    expect(empty(es)).toEqual([]);
    expect(empty(en)).toEqual([]);
  });

  // A new audit event can't ship without its label in both languages (FR-NOT-4).
  it('label every audit event', () => {
    for (const messages of [es, en]) {
      const labels = keys(messages.audit.actions).sort();
      expect(labels).toEqual([...AUDIT_ACTIONS].sort());
    }
  });

  // Every document status and timeline event has its words (FR-DOC-12, FR-DOC-13).
  it('label every document status and event', () => {
    for (const messages of [es, en]) {
      expect(keys(messages.documents.statuses).sort()).toEqual([...DOCUMENT_STATUSES].sort());
      expect(keys(messages.documents.statusHelp).sort()).toEqual([...DOCUMENT_STATUSES].sort());
      expect(keys(messages.documents.detail.timeline.events).sort()).toEqual(
        [...DOCUMENT_EVENT_TYPES].sort(),
      );
    }
  });

  // The SRI catalogues are code (ADR-012); each code is shown by its label.
  it('label every SRI catalogue code', () => {
    const catalogues = {
      documentTypes: SRI_DOCUMENT_TYPES,
      idTypes: SRI_ID_TYPES,
      ivaRates: SRI_IVA_RATES.map((rate) => rate.code),
      paymentMethods: SRI_PAYMENT_METHODS,
      termUnits: SRI_TERM_UNITS,
    };
    for (const messages of [es, en])
      for (const [name, codes] of Object.entries(catalogues))
        expect(Object.keys(messages.sri[name as keyof typeof catalogues]).sort()).toEqual(
          [...codes].sort(),
        );
  });
});
