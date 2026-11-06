import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOCUMENT_TYPES, ISSUABLE_TYPES, type IssuableType } from './document-types';
import xmldsigCore from './xsd/xmldsig-core';

// ADR-013: xmllint (libxml2) validates; the schemas are embedded and written to a
// temporary folder once per process, under the names the document XSDs import.
export type ValidatedDocumentType = IssuableType;

// ADR-013: every document schema's published pattern takes only the emprendedor legend, though
// Anexo 22 also requires the negocio popular one. Widened here so the published files stay as is.
const PUBLISHED_RIMPE = '<xsd:pattern value="CONTRIBUYENTE RÉGIMEN RIMPE"/>';

export function widenRimpe(published: string): string {
  if (!published.includes(PUBLISHED_RIMPE)) {
    throw new Error('The XSD no longer has the RIMPE pattern to widen.');
  }
  return published.replace(
    PUBLISHED_RIMPE,
    `${PUBLISHED_RIMPE}<xsd:pattern value="CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE"/>`,
  );
}

let folder: Promise<string> | undefined;

function schemaFolder(): Promise<string> {
  folder ??= (async () => {
    const path = await mkdtemp(join(/*turbopackIgnore: true*/ tmpdir(), 'comprobify-xsd-'));
    for (const type of ISSUABLE_TYPES) {
      const { schemaFile, xsd } = DOCUMENT_TYPES[type];
      await writeFile(join(/*turbopackIgnore: true*/ path, schemaFile), widenRimpe(xsd));
    }
    await writeFile(join(/*turbopackIgnore: true*/ path, 'xmldsig-core-schema.xsd'), xmldsigCore);
    return path;
  })().catch((error: unknown) => {
    folder = undefined;
    throw error;
  });
  return folder;
}

export type XsdResult = { valid: true } | { valid: false; errors: string[] };

// Exit 0 is valid, 3 and 4 are an invalid or unreadable document; anything else
// (xmllint missing, killed) is our failure, not the document's.
export async function validateXml(
  xml: string,
  documentType: ValidatedDocumentType,
): Promise<XsdResult> {
  // A temporary folder, not a project file: nothing for Next to trace.
  const schema = join(
    /*turbopackIgnore: true*/ await schemaFolder(),
    DOCUMENT_TYPES[documentType].schemaFile,
  );
  return new Promise((resolve, reject) => {
    const child = spawn('xmllint', ['--noout', '--nonet', '--schema', schema, '-'], {
      stdio: ['pipe', 'ignore', 'pipe'],
      timeout: 10_000,
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ valid: true });
      if (code === 3 || code === 4) {
        const errors = stderr
          .split('\n')
          .filter((line) => /error/i.test(line))
          // "-:1: element x: Schemas validity error : …" → the part after the location.
          .map((line) => line.replace(/^-:\d+:\s*/, '').trim());
        return resolve({ valid: false, errors: errors.length > 0 ? errors : [stderr.trim()] });
      }
      reject(new Error(`xmllint failed with exit code ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(xml, 'utf8');
  });
}
