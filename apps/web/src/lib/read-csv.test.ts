import { describe, expect, it } from 'vitest';
import { readCsvFile } from './read-csv';

const file = (bytes: Uint8Array) => new File([bytes as BlobPart], 'productos.csv');

describe('readCsvFile', () => {
  it('reads UTF-8, with or without the byte order mark', async () => {
    const utf8 = new TextEncoder().encode('Azúcar;1,10');
    expect(await readCsvFile(file(utf8))).toBe('Azúcar;1,10');
    expect(await readCsvFile(file(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])))).toBe(
      'Azúcar;1,10',
    );
  });

  it('reads Excel\'s UTF-16 "Unicode Text" by its mark', async () => {
    const units = [0xfeff, ...'Azúcar\t1,1'].map((unit) =>
      typeof unit === 'number' ? unit : unit.charCodeAt(0),
    );
    const bytes = new Uint8Array(units.flatMap((unit) => [unit & 0xff, unit >> 8]));
    expect(await readCsvFile(file(bytes))).toBe('Azúcar\t1,1');
  });

  it("reads Excel's Windows-1252 file, where ú is the single byte 0xFA", async () => {
    // "Azúcar" and "Café" as Spanish Excel saves a plain "CSV".
    const bytes = new Uint8Array([
      0x41, 0x7a, 0xfa, 0x63, 0x61, 0x72, 0x3b, 0x43, 0x61, 0x66, 0xe9,
    ]);
    expect(await readCsvFile(file(bytes))).toBe('Azúcar;Café');
  });

  it("reads Excel for Mac's Mac Roman text, where ú is 0x9C and é is 0x8E", async () => {
    // The products file that came back as "Azœcar" and "CafŽ": the same bytes read as Windows-1252.
    const bytes = new Uint8Array([
      0x41, 0x7a, 0x9c, 0x63, 0x61, 0x72, 0x3b, 0x43, 0x61, 0x66, 0x8e, 0x3b, 0x49, 0x6e, 0x73,
      0x74, 0x61, 0x6c, 0x61, 0x63, 0x69, 0x97, 0x6e,
    ]);
    expect(await readCsvFile(file(bytes))).toBe('Azúcar;Café;Instalación');
  });

  it('keeps Windows-1252 text that has curly quotes and a few accents', async () => {
    // 0x93 and 0x94 are curly quotes in Windows-1252; the accents (0xE9, 0xF3) outnumber them.
    const bytes = new Uint8Array([
      0x93, 0x43, 0x61, 0x66, 0xe9, 0x94, 0x20, 0x61, 0x63, 0x63, 0x69, 0xf3, 0x6e,
    ]);
    expect(await readCsvFile(file(bytes))).toBe('“Café” acción');
  });
});
