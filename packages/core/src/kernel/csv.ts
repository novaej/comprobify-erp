// CSV as spreadsheets save it. Excel in Spanish uses ';' between fields and ',' for decimals;
// in English ',' and '.'. The delimiter is the one the header line uses.

export type Csv = { delimiter: ',' | ';'; rows: string[][] };

export function parseCsv(text: string): Csv {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Blank lines, which spreadsheets leave at the end, are not rows.
  return { delimiter, rows: rows.filter((cells) => cells.some((cell) => cell.trim() !== '')) };
}

// A number as typed in that spreadsheet: '2,50' with ';' files, '2.50' with ',' files.
export function csvDecimal(value: string, delimiter: Csv['delimiter']): string {
  const trimmed = value.trim();
  return delimiter === ';' ? trimmed.replace(',', '.') : trimmed;
}
