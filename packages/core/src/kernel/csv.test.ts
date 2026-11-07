import { describe, expect, it } from 'vitest';
import { csvDecimal, parseCsv } from './csv';

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
