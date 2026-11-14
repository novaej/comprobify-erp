// CSV as spreadsheets save it. Excel in Spanish uses ';' between fields and ',' for decimals;
// in English ',' and '.'. A file saved as tab-delimited text is read too. The delimiter is the
// one the header line uses most.

export type Csv = { delimiter: ',' | ';' | '\t'; rows: string[][] };

export function parseCsv(text: string): Csv {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const count = (mark: string) => firstLine.split(mark).length - 1;
  const delimiter: Csv['delimiter'] =
    count('\t') > count(';') && count('\t') > count(',')
      ? '\t'
      : count(';') > count(',')
        ? ';'
        : ',';
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

// A number as typed in that spreadsheet: '2,50' with ';' files, '2.50' with ',' files. A tab file
// takes either, as it has no regional habit of its own.
export function csvDecimal(value: string, delimiter: Csv['delimiter']): string {
  const trimmed = value.trim();
  return delimiter === ',' ? trimmed : trimmed.replace(',', '.');
}

// A cell as spreadsheets read it: quoted when it holds the delimiter, a quote or a line break.
const cell = (value: string, delimiter: string) =>
  value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

// The file a spreadsheet opens directly: a byte-order mark so Excel reads UTF-8, CRLF lines.
export function toCsv(rows: string[][], delimiter: Csv['delimiter']): string {
  return `\uFEFF${rows.map((row) => row.map((value) => cell(value, delimiter)).join(delimiter)).join('\r\n')}\r\n`;
}
