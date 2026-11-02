import { describe, expect, it } from 'vitest';
import { isValidRucStructure, LOGO_MAX_BYTES, sniffLogo } from '.';

describe('RUC structure', () => {
  it.each(['1712345678001', '0990011223001', '1760001230001', '3012345678001'])(
    'accepts %s',
    (ruc) => {
      expect(isValidRucStructure(ruc)).toBe(true);
    },
  );

  it.each([
    ['too short', '171234567800'],
    ['letters', '17123456780A1'],
    ['province 00', '0012345678001'],
    ['province 25', '2512345678001'],
    ['third digit 7', '1772345678001'],
    ['establishment 000', '1712345678000'],
  ])('refuses %s', (_, ruc) => {
    expect(isValidRucStructure(ruc)).toBe(false);
  });
});

describe('logo', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

  it('recognizes PNG, JPEG and GIF by their bytes', () => {
    expect(sniffLogo(png).contentType).toBe('image/png');
    expect(sniffLogo(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).contentType).toBe('image/jpeg');
    expect(sniffLogo(Buffer.from('GIF89a...')).contentType).toBe('image/gif');
  });

  it('refuses other content whatever its name claims, and files over 500 KB', () => {
    expect(() => sniffLogo(Buffer.from('<svg/>'))).toThrow(
      expect.objectContaining({ code: 'INVALID_LOGO' }) as Error,
    );
    expect(() => sniffLogo(Buffer.concat([png, Buffer.alloc(LOGO_MAX_BYTES)]))).toThrow(
      expect.objectContaining({ code: 'INVALID_LOGO' }) as Error,
    );
  });
});
