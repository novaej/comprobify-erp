import { describe, expect, it } from 'vitest';
import { csvDecimal, parseCsv, toCsv } from './csv';

describe('a tab-delimited file', () => {
  it('is read by its header, with a decimal comma or point', () => {
    const text = 'codigo\tnombre\tprecio\r\nAZU-1\tAzúcar\t1,1\r\n';
    expect(parseCsv(text)).toEqual({
      delimiter: '\t',
      rows: [
        ['codigo', 'nombre', 'precio'],
        ['AZU-1', 'Azúcar', '1,1'],
      ],
    });
    expect(csvDecimal('1,1', '\t')).toBe('1.1');
    expect(csvDecimal('1.1', '\t')).toBe('1.1');
    // The other two keep their habit.
    expect(csvDecimal('1,1', ';')).toBe('1.1');
    expect(csvDecimal('1,1', ',')).toBe('1,1');
  });
});

describe('parseCsv', () => {
  it('reads a comma file with quotes and a trailing blank line', () => {
    expect(parseCsv('code,name\r\nA,"Café, molido"\r\nB,"Dice ""hola"""\r\n\r\n')).toEqual({
      delimiter: ',',
      rows: [
        ['code', 'name'],
        ['A', 'Café, molido'],
        ['B', 'Dice "hola"'],
      ],
    });
  });

  it('reads the semicolon file Excel saves in Spanish, with its decimal commas', () => {
    const csv = parseCsv('\uFEFFcodigo;cantidad;costo\nA;10;2,50\n');
    expect(csv).toEqual({
      delimiter: ';',
      rows: [
        ['codigo', 'cantidad', 'costo'],
        ['A', '10', '2,50'],
      ],
    });
    expect(csvDecimal('2,50', csv.delimiter)).toBe('2.50');
    expect(csvDecimal(' 2.50 ', ',')).toBe('2.50');
  });

  it('keeps a last line without a line break', () => {
    expect(parseCsv('a,b\n1,2').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('toCsv', () => {
  it('quotes what needs it, and what it writes parses back', () => {
    const rows = [
      ['code', 'name'],
      ['A', 'Café, molido'],
      ['B', 'Dice "hola"'],
      ['C', 'dos\nlíneas'],
    ];
    for (const delimiter of [',', ';'] as const) {
      const text = toCsv(rows, delimiter);
      expect(text.startsWith('\uFEFF')).toBe(true);
      expect(text.endsWith('\r\n')).toBe(true);
      expect(parseCsv(text).rows).toEqual(rows);
    }
  });
});
