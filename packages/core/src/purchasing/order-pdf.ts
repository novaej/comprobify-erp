import PDFDocument from 'pdfkit';

// FR-PUR-3: the order as the provider receives it, A4, in the RIDE's plain style. Long orders
// break onto more pages, repeating the item header. Spanish: the order is.

export type OrderPdfData = {
  number: string;
  orderDate: string;
  expectedDate: string | null;
  notes: string | null;
  // The company's test copy: stamped so it can't pass for a real order.
  test: boolean;
  company: { legalName: string; tradeName: string | null; ruc: string; mainAddress: string };
  logo: Buffer | null;
  provider: { name: string; identification: string; emails: string[] };
  delivery: { warehouse: string; address: string };
  lines: {
    code: string;
    name: string;
    unit: string | null;
    quantity: string;
    unitCost: string;
    ivaLabel: string;
    subtotal: string;
  }[];
  totals: { subtotal: string; taxes: { label: string; value: string }[]; total: string };
  // For tests: uncompressed streams can be read back.
  compress?: boolean;
};

const M = 36;
const PAGE_H = 841.89;
const CW = 595.28 - M * 2;
const BOTTOM = PAGE_H - M;
const DARK = '#1A1A1A';
const GREY = '#555555';
const BORDER = '#BBBBBB';
const HEADER_BG = '#F0F0F0';

type Doc = PDFKit.PDFDocument;
type TextOptions = {
  size?: number;
  bold?: boolean;
  align?: 'left' | 'right' | 'center';
  color?: string;
};

const font = (doc: Doc, { size = 8.5, bold = false }: TextOptions) =>
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
const height = (doc: Doc, value: string, width: number, options: TextOptions = {}) =>
  font(doc, options).heightOfString(value, { width });
function write(
  doc: Doc,
  value: string,
  x: number,
  y: number,
  width: number,
  options: TextOptions = {},
) {
  doc.save();
  font(doc, options)
    .fillColor(options.color ?? DARK)
    .text(value, x, y, { width, align: options.align ?? 'left' });
  doc.restore();
}
const hline = (doc: Doc, y: number, color = BORDER) =>
  doc
    .save()
    .moveTo(M, y)
    .lineTo(M + CW, y)
    .stroke(color)
    .restore();

// Quantities and costs as stored, without trailing zeros; money with its two places.
const trim = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);
const decimalComma = (value: string) => value.replace('.', ',');
const price = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return decimalComma(`${whole}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`);
};
const date = (iso: string) => iso.split('-').reverse().join('/');

function header(doc: Doc, data: OrderPdfData): number {
  let y = M;
  const leftW = CW * 0.55;
  if (data.logo) {
    try {
      doc.image(data.logo, M, y, { fit: [140, 60] });
      y += 66;
    } catch {
      // A logo pdfkit can't read is left out rather than failing the order.
    }
  }
  write(doc, data.company.tradeName ?? data.company.legalName, M, y, leftW, {
    size: 12,
    bold: true,
  });
  y +=
    height(doc, data.company.tradeName ?? data.company.legalName, leftW, { size: 12, bold: true }) +
    2;
  if (data.company.tradeName) {
    write(doc, data.company.legalName, M, y, leftW, { color: GREY });
    y += height(doc, data.company.legalName, leftW) + 1;
  }
  write(doc, `RUC: ${data.company.ruc}`, M, y, leftW, { color: GREY });
  y += 11;
  write(doc, data.company.mainAddress, M, y, leftW, { color: GREY });
  y += height(doc, data.company.mainAddress, leftW) + 2;

  const rx = M + leftW + 12;
  const rw = CW - leftW - 12;
  let ry = M;
  write(doc, 'ORDEN DE COMPRA', rx, ry, rw, { size: 15, bold: true, align: 'right' });
  ry += 20;
  write(doc, data.number, rx, ry, rw, { size: 12, bold: true, align: 'right' });
  ry += 18;
  write(doc, `Fecha: ${date(data.orderDate)}`, rx, ry, rw, { align: 'right' });
  ry += 12;
  if (data.expectedDate) {
    write(doc, `Entrega prevista: ${date(data.expectedDate)}`, rx, ry, rw, { align: 'right' });
    ry += 12;
  }
  if (data.test) {
    write(doc, 'PRUEBA: NO ES UN PEDIDO REAL', rx, ry + 2, rw, {
      bold: true,
      align: 'right',
      color: '#B45309',
    });
    ry += 16;
  }
  return Math.max(y, ry) + 10;
}

function parties(doc: Doc, data: OrderPdfData, y: number): number {
  const P = 8;
  const half = (CW - 12) / 2;
  const block = (x: number, title: string, rows: string[]) => {
    const body = rows.filter(Boolean).join('\n');
    const h = 22 + height(doc, body, half - P * 2) + P;
    doc.save().rect(x, y, half, h).stroke(BORDER).restore();
    write(doc, title, x + P, y + P, half - P * 2, { size: 7.5, bold: true, color: GREY });
    write(doc, body, x + P, y + P + 12, half - P * 2);
    return h;
  };
  const left = block(M, 'PROVEEDOR', [
    data.provider.name,
    `Identificación: ${data.provider.identification}`,
    data.provider.emails.join(', '),
  ]);
  const right = block(M + half + 12, 'ENTREGAR EN', [
    data.delivery.warehouse,
    data.delivery.address,
  ]);
  return y + Math.max(left, right) + 14;
}

const COLUMNS = [
  { key: 'code', title: 'Código', width: 70, align: 'left' },
  { key: 'name', title: 'Descripción', width: 0, align: 'left' },
  { key: 'quantity', title: 'Cantidad', width: 62, align: 'right' },
  { key: 'unitCost', title: 'Costo unit.', width: 66, align: 'right' },
  { key: 'iva', title: 'IVA', width: 58, align: 'left' },
  { key: 'subtotal', title: 'Subtotal', width: 66, align: 'right' },
] as const;

function columns() {
  const fixed = COLUMNS.reduce((sum, column) => sum + column.width, 0);
  let x = M;
  return COLUMNS.map((column) => {
    const width = column.width || CW - fixed;
    const placed = { ...column, x, width };
    x += width;
    return placed;
  });
}

function itemHeader(doc: Doc, y: number): number {
  doc.save().rect(M, y, CW, 16).fill(HEADER_BG).restore();
  for (const column of columns())
    write(doc, column.title, column.x + 4, y + 4, column.width - 8, {
      size: 7.5,
      bold: true,
      align: column.align,
    });
  return y + 16;
}

function items(doc: Doc, data: OrderPdfData, y: number): number {
  y = itemHeader(doc, y);
  const placed = columns();
  for (const line of data.lines) {
    const cells: Record<(typeof COLUMNS)[number]['key'], string> = {
      code: line.code,
      name: line.name,
      quantity: `${decimalComma(trim(line.quantity))}${line.unit ? ` ${line.unit}` : ''}`,
      unitCost: price(line.unitCost),
      iva: line.ivaLabel,
      subtotal: price(line.subtotal),
    };
    const h =
      Math.max(...placed.map((column) => height(doc, cells[column.key], column.width - 8))) + 8;
    if (y + h > BOTTOM) {
      doc.addPage();
      y = itemHeader(doc, M);
    }
    for (const column of placed)
      write(doc, cells[column.key], column.x + 4, y + 4, column.width - 8, { align: column.align });
    y += h;
    hline(doc, y);
  }
  return y + 10;
}

function bottom(doc: Doc, data: OrderPdfData, y: number) {
  const rows: [string, string, boolean][] = [
    ['Subtotal', price(data.totals.subtotal), false],
    ...data.totals.taxes.map((tax): [string, string, boolean] => [
      tax.label,
      price(tax.value),
      false,
    ]),
    ['TOTAL', price(data.totals.total), true],
  ];
  const notesH = data.notes ? 16 + height(doc, data.notes, CW * 0.55) : 0;
  if (y + Math.max(rows.length * 15, notesH) > BOTTOM) {
    doc.addPage();
    y = M;
  }
  const tx = M + CW - 200;
  rows.forEach(([label, value, strong], i) => {
    const ry = y + i * 15;
    write(doc, label, tx, ry, 120, { bold: strong, size: strong ? 10 : 8.5 });
    write(doc, `$${value}`, tx + 120, ry, 80, {
      bold: strong,
      size: strong ? 10 : 8.5,
      align: 'right',
    });
  });
  if (data.notes) {
    write(doc, 'NOTAS', M, y, CW * 0.55, { size: 7.5, bold: true, color: GREY });
    write(doc, data.notes, M, y + 12, CW * 0.55);
  }
}

export function renderPurchaseOrderPdf(data: OrderPdfData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: M, bottom: M, left: M, right: M },
    compress: data.compress ?? true,
    info: { Title: `Orden de compra ${data.number}`, Author: data.company.legalName },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  let y = header(doc, data);
  y = parties(doc, data, y);
  y = items(doc, data, y);
  bottom(doc, data, y);
  doc.end();
  return done;
}
