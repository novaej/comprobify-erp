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
});
