import bwipjs from 'bwip-js/node';
import PDFDocument from 'pdfkit';
import { ecuadorDateTimeDisplay } from '../kernel';
import { totalRows, type RideData } from './ride-data';
import {
  RIDE_DOCUMENT_TITLES,
  RIDE_PAYMENT_METHODS,
  RIDE_TERM_UNITS,
  rideAmbiente,
  rideEmission,
} from './ride-labels';

// FR-DOC-10: an A4 RIDE with the access key's Code 128 barcode. The layout follows the
// one SRI's own RIDE uses; long documents break onto more pages, repeating the item
// header.

export type RideExtras = {
  authorizationNumber: string;
  authorizedAt: Date;
  // Live, and only while the company has RIDE_LOGO: the one thing not from the XML.
  logo: Buffer | null;
  // For tests: uncompressed streams can be read back.
  compress?: boolean;
};

const PAGE_H = 841.89;
const M = 30;
const CW = 595.28 - M * 2;
const BOTTOM = PAGE_H - M;
const DARK = '#1A1A1A';
const GREY = '#555555';
const BORDER = '#AAAAAA';
const HEADER_BG = '#F0F0F0';
const ROW_BG = '#F8F8F8';

type Doc = PDFKit.PDFDocument;
type TextOptions = {
  size?: number;
  bold?: boolean;
  align?: 'left' | 'right' | 'center';
  color?: string;
};

const font = (doc: Doc, { size = 8, bold = false }: TextOptions) =>
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);

function height(doc: Doc, value: string, width: number, options: TextOptions = {}): number {
  return font(doc, options).heightOfString(value, { width });
}

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
    .fillColor(options.color ?? '#000000')
    .text(value, x, y, { width, align: options.align ?? 'left', lineBreak: true });
  doc.restore();
}

const box = (doc: Doc, x: number, y: number, w: number, h: number, stroke = DARK) =>
  doc.save().rect(x, y, w, h).stroke(stroke).restore();
const filled = (doc: Doc, x: number, y: number, w: number, h: number, fill: string) =>
  doc.save().rect(x, y, w, h).fillAndStroke(fill, DARK).restore();
const hline = (doc: Doc, x: number, y: number, w: number, color = BORDER) =>
  doc
    .save()
    .moveTo(x, y)
    .lineTo(x + w, y)
    .stroke(color)
    .restore();
const vline = (doc: Doc, x: number, y: number, h: number, color = DARK) =>
  doc
    .save()
    .moveTo(x, y)
    .lineTo(x, y + h)
    .stroke(color)
    .restore();

function barcode(accessKey: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: accessKey,
    scale: 2,
    height: 10,
    includetext: false,
  });
}

async function header(doc: Doc, data: RideData, extras: RideExtras, y: number): Promise<number> {
  const P = 6;
  const leftW = Math.round(CW * 0.42);
  const rightW = CW - leftW;
  const lx = M;
  const rx = M + leftW;
  const rw = rightW - P * 2;
  const labelW = Math.round(rw * 0.5);
  const valueW = rw - labelW - 3;
  const number = `${data.establishment}-${data.issuePoint}-${data.sequential}`;
  const authorized = ecuadorDateTimeDisplay(extras.authorizedAt);

  const right: [string, string | null, TextOptions][] = [
    ['AMBIENTE:', rideAmbiente(data.ambiente), { size: 7.5 }],
    ['EMISIÓN:', rideEmission(data.emissionType), { size: 7.5 }],
  ];
  const rightH =
    P * 2 +
    16 +
    height(doc, RIDE_DOCUMENT_TITLES[data.documentType] ?? 'COMPROBANTE', rw, {
      size: 14,
      bold: true,
    }) +
    4 +
    14 +
    10 +
    height(doc, extras.authorizationNumber, rw, { size: 7.5 }) +
    6 +
    height(doc, 'FECHA Y HORA DE\nAUTORIZACIÓN:', labelW, { size: 7 }) +
    4 +
    right.length * 12 +
    10 +
    40 +
    10;

  // Left: logo, names, addresses and the legends SRI requires on the RIDE.
  const lw = leftW - P * 2;
  const legends = [
    data.specialTaxpayer ? `CONTRIBUYENTE ESPECIAL Nro. ${data.specialTaxpayer}` : null,
    `OBLIGADO A LLEVAR CONTABILIDAD: ${data.requiredAccounting === 'SI' ? 'SI' : 'NO'}`,
    // Anexo 21 and 22.
    data.withholdingAgent ? `AGENTE DE RETENCIÓN RESOLUCIÓN No. ${data.withholdingAgent}` : null,
    data.rimpe,
  ].filter((value): value is string => value !== null);
  const addressLabel = 38;
  const addresses: [string, string][] = [
    ['Dirección\nMatriz:', data.mainAddress],
    ...(data.branchAddress
      ? ([['Dirección\nSucursal:', data.branchAddress]] as [string, string][])
      : []),
  ];
  const leftH =
    P * 2 +
    64 +
    height(doc, data.legalName, lw, { size: 9, bold: true }) +
    3 +
    (data.tradeName ? height(doc, data.tradeName, lw, { size: 8 }) + 3 : 0) +
    addresses.reduce(
      (sum, [label, value]) =>
        sum +
        Math.max(
          height(doc, label, addressLabel, { size: 7 }),
          height(doc, value, lw - addressLabel - 3, { size: 7 }),
        ) +
        5,
      4,
    ) +
    legends.reduce((sum, legend) => sum + height(doc, legend, lw, { size: 7, bold: true }) + 3, 4);
  const h = Math.max(leftH, rightH);
  box(doc, lx, y, leftW, h);
  box(doc, rx, y, rightW, h);

  let ly = y + P;
  if (extras.logo) {
    try {
      doc.image(extras.logo, lx + P, ly, { fit: [lw, 60] });
    } catch {
      // An unreadable logo leaves its space empty.
    }
  }
  ly += 64;
  write(doc, data.legalName, lx + P, ly, lw, { size: 9, bold: true });
  ly += height(doc, data.legalName, lw, { size: 9, bold: true }) + 3;
  if (data.tradeName) {
    write(doc, data.tradeName, lx + P, ly, lw, { size: 8 });
    ly += height(doc, data.tradeName, lw, { size: 8 }) + 3;
  }
  ly += 4;
  for (const [label, value] of addresses) {
    write(doc, label, lx + P, ly, addressLabel, { size: 7, color: GREY });
    write(doc, value, lx + P + addressLabel + 3, ly, lw - addressLabel - 3, { size: 7 });
    ly +=
      Math.max(
        height(doc, label, addressLabel, { size: 7 }),
        height(doc, value, lw - addressLabel - 3, { size: 7 }),
      ) + 5;
  }
  ly += 4;
  for (const legend of legends) {
    write(doc, legend, lx + P, ly, lw, { size: 7, bold: true });
    ly += height(doc, legend, lw, { size: 7, bold: true }) + 3;
  }

  // Right: RUC, document, number, authorization, ambiente, emission, access key.
  const ri = rx + P;
  let ry = y + P;
  write(doc, 'R.U.C.:', ri, ry + 1, 36, { size: 8, color: GREY });
  write(doc, data.ruc, ri + 40, ry, rw - 40, { size: 10, bold: true });
  ry += 16;
  const title = RIDE_DOCUMENT_TITLES[data.documentType] ?? 'COMPROBANTE';
  write(doc, title, ri, ry, rw, { size: 14, bold: true });
  ry += height(doc, title, rw, { size: 14, bold: true }) + 4;
  write(doc, `No. ${number}`, ri, ry, rw, { size: 8 });
  ry += 14;
  hline(doc, rx + 3, ry - 2, rightW - 6);
  write(doc, 'NÚMERO DE AUTORIZACIÓN', ri, ry, rw, { size: 7, color: GREY });
  ry += 10;
  write(doc, extras.authorizationNumber, ri, ry, rw, { size: 7.5 });
  ry += height(doc, extras.authorizationNumber, rw, { size: 7.5 }) + 6;
  write(doc, 'FECHA Y HORA DE\nAUTORIZACIÓN:', ri, ry, labelW, { size: 7, color: GREY });
  write(doc, authorized, ri + labelW + 3, ry, valueW, { size: 7.5 });
  ry += height(doc, 'FECHA Y HORA DE\nAUTORIZACIÓN:', labelW, { size: 7 }) + 4;
  for (const [label, value, options] of right) {
    write(doc, label, ri, ry, labelW, { ...options, color: GREY });
    write(doc, value ?? '', ri + labelW + 3, ry, valueW, options);
    ry += 12;
  }
  hline(doc, rx + 3, ry, rightW - 6);
  write(doc, 'CLAVE DE ACCESO', ri, ry + 2, rw, { size: 7, color: GREY });
  ry += 10;
  doc.image(await barcode(data.accessKey), ri, ry, { width: rw, height: 36 });
  ry += 40;
  write(doc, data.accessKey, ri, ry, rw, { size: 6, align: 'center', color: GREY });

  return y + h + 4;
}

function buyer(doc: Doc, data: RideData, y: number): number {
  const P = 4;
  const nameH = Math.max(14, height(doc, data.buyer.name, CW - 180, { size: 8 }) + 6);
  const rowH = 22;
  const addressH = Math.max(14, height(doc, data.buyer.address ?? '', CW - 58, { size: 7.5 }) + 6);
  box(doc, M, y, CW, nameH + rowH + addressH);
  hline(doc, M, y + nameH, CW, DARK);
  hline(doc, M, y + nameH + rowH, CW, DARK);
  write(doc, 'Razón Social / Nombres y Apellidos:', M + P, y + P, 168, { size: 7, color: GREY });
  write(doc, data.buyer.name, M + P + 172, y + P - 1, CW - 180, { size: 8 });
  const cell = CW / 3;
  const cells: [string, string][] = [
    ['Identificación', data.buyer.identification],
    ['Fecha de emisión', data.issueDate],
    ['Guía de remisión', ''],
  ];
  cells.forEach(([label, value], index) => {
    const cx = M + index * cell;
    if (index > 0) vline(doc, cx, y + nameH, rowH);
    write(doc, label, cx + P, y + nameH + 3, cell - P * 2, { size: 6.5, color: GREY });
    write(doc, value, cx + P, y + nameH + 11, cell - P * 2, { size: 8 });
  });
  write(doc, 'Dirección:', M + P, y + nameH + rowH + 3, 46, { size: 7, color: GREY });
  write(doc, data.buyer.address ?? '', M + P + 50, y + nameH + rowH + 3, CW - 58, { size: 7.5 });
  return y + nameH + rowH + addressH + 4;
}

type Column = {
  label: string;
  width: number;
  align: 'left' | 'right';
  value: (line: RideData['lines'][number]) => string;
};

const COLUMNS: Column[] = [
  { label: 'Cod.\nPrincipal', width: 52, align: 'left', value: (line) => line.code },
  { label: 'Cod.\nAuxiliar', width: 48, align: 'left', value: (line) => line.auxiliaryCode ?? '' },
  { label: 'Cantidad', width: 46, align: 'right', value: (line) => line.quantity },
  { label: 'Descripción', width: 0, align: 'left', value: (line) => line.description },
  {
    label: 'Detalle\nAdicional',
    width: 78,
    align: 'left',
    value: (line) => line.details.map((detail) => `${detail.name}: ${detail.value}`).join('\n'),
  },
  { label: 'Precio\nUnitario', width: 56, align: 'right', value: (line) => line.unitPrice },
  { label: 'Descuento', width: 44, align: 'right', value: (line) => line.discount },
  { label: 'Precio\nTotal', width: 52, align: 'right', value: (line) => line.total },
];

function items(doc: Doc, data: RideData, y: number): number {
  const P = 3;
  const fixed = COLUMNS.reduce((sum, column) => sum + column.width, 0);
  let x = M;
  const columns = COLUMNS.map((column) => {
    const width = column.width || CW - fixed;
    const placed = { ...column, width, x };
    x += width;
    return placed;
  });
  const headerH = 22;
  const drawHeader = (top: number) => {
    filled(doc, M, top, CW, headerH, HEADER_BG);
    for (const column of columns) {
      if (column.x > M) vline(doc, column.x, top, headerH);
      write(doc, column.label, column.x + P, top + 3, column.width - P * 2, {
        size: 6.5,
        bold: true,
        align: column.align,
      });
    }
    return top + headerH;
  };

  y = drawHeader(y);
  data.lines.forEach((line, index) => {
    const values = columns.map((column) => column.value(line));
    const rowH = Math.max(
      14,
      ...columns.map(
        (column, i) => height(doc, values[i]!, column.width - P * 2, { size: 7.5 }) + 6,
      ),
    );
    if (y + rowH > BOTTOM) {
      doc.addPage();
      y = drawHeader(M);
    }
    if (index % 2 === 1) filled(doc, M, y, CW, rowH, ROW_BG);
    else box(doc, M, y, CW, rowH);
    columns.forEach((column, i) => {
      if (column.x > M) vline(doc, column.x, y, rowH);
      write(doc, values[i]!, column.x + P, y + 3, column.width - P * 2, {
        size: 7.5,
        align: column.align,
      });
    });
    y += rowH;
  });
  return y + 4;
}

function paymentLabel(payment: RideData['payments'][number]): string {
  const base = `${payment.method} - ${RIDE_PAYMENT_METHODS[payment.method] ?? ''}`;
  if (!payment.term || !payment.termUnit) return base;
  return `${base} (${payment.term} ${RIDE_TERM_UNITS[payment.termUnit] ?? payment.termUnit.toUpperCase()})`;
}

function bottom(doc: Doc, data: RideData, y: number): number {
  const P = 4;
  const leftW = Math.round(CW * 0.54);
  const rightW = CW - leftW;
  const lx = M;
  const rx = M + leftW;
  const headerH = 14;
  const keyW = Math.round(leftW * 0.35);
  const valueW = leftW - keyW - P * 3;
  const amountW = 62;
  const labelW = leftW - amountW;
  const totalW = 62;

  const fieldH = data.additionalInfo.map(
    (field) =>
      Math.max(
        13,
        height(doc, `${field.name}:`, keyW - P, { size: 7, bold: true }),
        height(doc, field.value, valueW, { size: 7 }),
      ) + 4,
  );
  const paymentH = data.payments.map(
    (payment) => Math.max(13, height(doc, paymentLabel(payment), labelW - P * 2, { size: 7 })) + 4,
  );
  const rows = totalRows(data);
  const leftH =
    (data.additionalInfo.length > 0 ? headerH + fieldH.reduce((a, b) => a + b, 0) : 0) +
    headerH +
    paymentH.reduce((a, b) => a + b, 0);
  const rightH = rows.length * 17;
  const h = Math.max(leftH, rightH);
  if (y + h > BOTTOM) {
    doc.addPage();
    y = M;
  }
  box(doc, lx, y, leftW, h);
  box(doc, rx, y, rightW, h);

  let ly = y;
  if (data.additionalInfo.length > 0) {
    filled(doc, lx, ly, leftW, headerH, HEADER_BG);
    write(doc, 'Información Adicional', lx + P, ly + 3, leftW - P * 2, {
      size: 7.5,
      bold: true,
      align: 'center',
    });
    ly += headerH;
    data.additionalInfo.forEach((field, i) => {
      hline(doc, lx, ly, leftW);
      write(doc, `${field.name}:`, lx + P, ly + 3, keyW - P, { size: 7, bold: true });
      write(doc, field.value, lx + keyW + P, ly + 3, valueW, { size: 7 });
      ly += fieldH[i]!;
    });
  }
  filled(doc, lx, ly, leftW, headerH, HEADER_BG);
  write(doc, 'Forma de pago', lx + P, ly + 3, labelW - P, { size: 7.5, bold: true });
  write(doc, 'Valor', lx + labelW + P, ly + 3, amountW - P * 2, {
    size: 7.5,
    bold: true,
    align: 'right',
  });
  vline(doc, lx + labelW, ly, headerH);
  ly += headerH;
  data.payments.forEach((payment, i) => {
    hline(doc, lx, ly, leftW);
    vline(doc, lx + labelW, ly, paymentH[i]!);
    write(doc, paymentLabel(payment), lx + P, ly + 3, labelW - P * 2, { size: 7 });
    write(doc, payment.total, lx + labelW + P, ly + 3, amountW - P * 2, {
      size: 7,
      align: 'right',
    });
    ly += paymentH[i]!;
  });

  let ry = y;
  for (const row of rows) {
    if (row.strong) filled(doc, rx, ry, rightW, 17, HEADER_BG);
    hline(doc, rx, ry, rightW);
    vline(doc, rx + rightW - totalW, ry, 17);
    write(doc, row.label, rx + P, ry + 4, rightW - totalW - P * 2, { size: 7, bold: !!row.strong });
    write(doc, row.value, rx + rightW - totalW + P, ry + 4, totalW - P * 2, {
      size: 7,
      bold: !!row.strong,
      align: 'right',
    });
    ry += 17;
  }
  return y + h;
}

export async function renderRide(data: RideData, extras: RideExtras): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: M, bottom: M, left: M, right: M },
    compress: extras.compress ?? true,
    info: {
      Title: `RIDE ${data.establishment}-${data.issuePoint}-${data.sequential}`,
      Author: data.legalName,
      Subject: 'Representación Impresa del Documento Electrónico',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  let y = await header(doc, data, extras, M);
  y = buyer(doc, data, y);
  y = items(doc, data, y);
  bottom(doc, data, y);
  doc.end();
  return done;
}
