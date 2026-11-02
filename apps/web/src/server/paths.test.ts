import { describe, expect, it } from 'vitest';
import { safeNextPath } from './paths';

describe('safeNextPath', () => {
  it('keeps our own paths', () => {
    expect(safeNextPath('/invite?token=abc')).toBe('/invite?token=abc');
  });

  it.each(['https://evil.test', '//evil.test', '/\\evil.test', 'invite', '', null, undefined])(
    'refuses %j',
    (next) => {
      expect(safeNextPath(next)).toBeNull();
    },
  );
});
