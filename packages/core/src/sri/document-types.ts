import facturaXsd from './xsd/factura-2.1.0';
import guiaRemisionXsd from './xsd/guia-remision-1.1.0';
import notaCreditoXsd from './xsd/nota-credito-1.1.0';

// FR-DOC-1: what the SRI engine knows about each type it issues. Adding a type is an entry here,
// plus its builder, its RIDE mapper and its screens. Retención (07) and liquidación (03) come
// after the MVP.
export const ISSUABLE_TYPES = ['01', '04', '06'] as const;
export type IssuableType = (typeof ISSUABLE_TYPES)[number];

export type DocumentTypeInfo = {
  // The name in the buyer's email and the screens' fallback (Spanish: SRI's documents are).
  label: string;
  // The XML's root element and the version its schema is published under.
  root: string;
  version: string;
  schemaFile: string;
  // The schema as SRI publishes it; xsd.ts widens the RIMPE pattern when it loads (ADR-013).
  xsd: string;
};

export const DOCUMENT_TYPES: Record<IssuableType, DocumentTypeInfo> = {
  '01': {
    label: 'Factura',
    root: 'factura',
    version: '2.1.0',
    schemaFile: 'factura_V2.1.0.xsd',
    xsd: facturaXsd,
  },
  '04': {
    label: 'Nota de Crédito',
    root: 'notaCredito',
    version: '1.1.0',
    schemaFile: 'nota_credito_V1.1.0.xsd',
    xsd: notaCreditoXsd,
  },
  '06': {
    label: 'Guía de Remisión',
    root: 'guiaRemision',
    version: '1.1.0',
    schemaFile: 'guia_remision_V1.1.0.xsd',
    xsd: guiaRemisionXsd,
  },
};

export const isIssuableType = (type: string): type is IssuableType =>
  (ISSUABLE_TYPES as readonly string[]).includes(type);

export function issuableType(type: string): IssuableType {
  if (!isIssuableType(type)) throw new Error(`No document type registered for ${type}`);
  return type;
}

export const documentTypeInfo = (type: string): DocumentTypeInfo =>
  DOCUMENT_TYPES[issuableType(type)];
