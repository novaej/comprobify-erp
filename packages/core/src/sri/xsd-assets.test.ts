import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_TYPES, ISSUABLE_TYPES, documentTypeInfo, isIssuableType } from './document-types';
import { RIDE_DOCUMENT_TITLES } from './ride-labels';
import { validateXml } from './xsd';
import xmldsigCore from './xsd/xmldsig-core';

const asset = (name: string) =>
  readFileSync(join(import.meta.dirname, '../../assets/xsd', name), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// The files in assets/xsd are the source; each embedded copy must be the same text, and the
// text is what SRI published (the hashes), so an edit there is a deliberate new version.
const HASHES: Record<string, string> = {
  'factura_V2.1.0.xsd': '5f2c37bc1a58bb40e8bbbc366cabe05d5dc199598aeea1561137370f8bd4eace',
  'nota_credito_V1.1.0.xsd': '379e9f270d71ab4578f130a736c9abe5eb1d7969375ecdef55d2973583ec5ab0',
  'guia_remision_V1.1.0.xsd': '2e95c0dd8b617f6c9884c0bae96ed4ca68e4eafb4ee6764140b4b37f12390ab9',
  'xmldsig-core-schema.xsd': '35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c',
};

describe('the XSD assets', () => {
  it('are what SRI published, and the embedded copies equal them', () => {
    for (const type of ISSUABLE_TYPES) {
      const { schemaFile, xsd } = DOCUMENT_TYPES[type];
      expect(xsd, schemaFile).toBe(asset(schemaFile));
      expect(sha256(xsd), schemaFile).toBe(HASHES[schemaFile]);
    }
    expect(xmldsigCore).toBe(asset('xmldsig-core-schema.xsd'));
    expect(sha256(xmldsigCore)).toBe(HASHES['xmldsig-core-schema.xsd']);
  });
});

describe('the document type registry (FR-DOC-1)', () => {
  it('describes each type fully: root element, version, RIDE title', () => {
    for (const type of ISSUABLE_TYPES) {
      const info = DOCUMENT_TYPES[type];
      expect(info.xsd, type).toContain(`<xsd:element name="${info.root}">`);
      expect(info.schemaFile, type).toContain(`V${info.version}`);
      expect(RIDE_DOCUMENT_TITLES[type], type).toBeTruthy();
    }
  });

  it('refuses a type that is not issued yet', () => {
    expect(isIssuableType('01')).toBe(true);
    expect(isIssuableType('07')).toBe(false);
    expect(() => documentTypeInfo('07')).toThrow('No document type registered');
  });

  it('loads every schema into xmllint: an empty document is invalid, not a crash', async () => {
    for (const type of ISSUABLE_TYPES) {
      await expect(validateXml('<x/>', type), type).resolves.toMatchObject({ valid: false });
    }
  });
});
