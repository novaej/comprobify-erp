import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { describe, expect, it } from 'vitest';
import { parseP12 } from '../certificates';
import { createTestP12, sampleFactura } from '../testing';
import { buildFactura } from './factura';
import { signXml } from './signer';
import { validateXml } from './xsd';

const now = new Date('2026-11-10T15:00:00Z');
const valid = { notBefore: new Date('2026-01-01'), notAfter: new Date('2027-12-31') };
const key = (options: Parameters<typeof createTestP12>[0] = valid, parsedAt = now) =>
  parseP12(createTestP12(options), 'secret', parsedAt);

// An independent check: xml-crypto runs real C14N and verifies both references and
// the signature value, which the signer only approximates with string building.
function verify(xml: string, certificatePem: string) {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const node = document.getElementsByTagNameNS(
    'http://www.w3.org/2000/09/xmldsig#',
    'Signature',
  )[0]!;
  const verifier = new SignedXml({ publicCert: certificatePem });
  verifier.loadSignature(node);
  try {
    return {
      valid: verifier.checkSignature(xml),
      references: verifier.getSignedReferences().length,
    };
  } catch {
    return { valid: false, references: 0 };
  }
}

describe('the XAdES-BES signer', () => {
  it('signs so a C14N verifier accepts both references, and the XSD still passes', async () => {
    const certificate = key();
    const { xml } = buildFactura(sampleFactura());
    const signed = signXml(xml, certificate, now);
    expect(verify(signed, certificate.certificatePem)).toEqual({ valid: true, references: 2 });
    await expect(validateXml(signed, '01')).resolves.toEqual({ valid: true });
    expect(signed).toContain('<etsi:SigningTime>2026-11-10T10:00:00-05:00</etsi:SigningTime>');
    expect(signed).toMatch(
      /<\/infoAdicional><ds:Signature [^>]+>[\s\S]*<\/ds:Signature><\/factura>$/,
    );
  });

  it('fails verification when a byte of the document changes after signing', () => {
    const certificate = key();
    const signed = signXml(buildFactura(sampleFactura()).xml, certificate, now);
    const tampered = signed.replace('<importeTotal>127.00', '<importeTotal>1.00');
    expect(verify(tampered, certificate.certificatePem).valid).toBe(false);
  });

  it('writes a long serial number exactly, in decimal', () => {
    const certificate = key({
      ...valid,
      serialNumber: '7f3a9c21e4b5d60718293a4b5c6d7e8f',
    });
    const signed = signXml(buildFactura(sampleFactura()).xml, certificate, now);
    expect(signed).toContain(
      `<ds:X509SerialNumber>${BigInt('0x7f3a9c21e4b5d60718293a4b5c6d7e8f').toString()}</ds:X509SerialNumber>`,
    );
    expect(signed).toContain('<ds:X509IssuerName>CN=Test CA,O=TEST CA S.A.</ds:X509IssuerName>');
  });

  it('refuses a certificate that expired after it was uploaded', () => {
    const expired = key(
      { notBefore: new Date('2024-01-01'), notAfter: new Date('2026-11-01') },
      new Date('2026-06-01'),
    );
    expect(() => signXml(buildFactura(sampleFactura()).xml, expired, now)).toThrow(
      expect.objectContaining({ code: 'CERTIFICATE_EXPIRED' }),
    );
  });
});
