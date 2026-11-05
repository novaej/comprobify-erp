import {
  DOCUMENT_EVENT_TYPES,
  DOCUMENT_STATUSES,
  DOCUMENT_TRANSITIONS,
  type DocumentStatus,
} from '@comprobify/db';
import { DomainError } from '../kernel';

export { DOCUMENT_EVENT_TYPES, DOCUMENT_STATUSES, DOCUMENT_TRANSITIONS, type DocumentStatus };

// FR-DOC-3, from the same definition the database trigger is generated from (rule 17).
export const canTransition = (from: DocumentStatus, to: DocumentStatus): boolean =>
  DOCUMENT_TRANSITIONS[from].includes(to);

export function assertTransition(from: DocumentStatus, to: DocumentStatus): void {
  if (!canTransition(from, to))
    throw new DomainError('INVALID_TRANSITION', `A document can not go from ${from} to ${to}`, {
      from,
      to,
    });
}
