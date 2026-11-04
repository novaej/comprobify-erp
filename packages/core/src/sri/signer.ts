import { createHash, createSign, randomInt } from 'node:crypto';
import forge from 'node-forge';
import { DomainError, ecuadorDateTime } from '../kernel';
import { escapeAttribute, escapeText, XML_DECLARATION } from './xml';

// XAdES-BES enveloped, RSA-SHA256, inclusive C14N 1.0, two references: the profile SRI
// accepts (ADR-013). The document arrives already canonical from xml.ts, so each digest
// is over the exact bytes a C14N verifier recomputes.

const DS = 'http://www.w3.org/2000/09/xmldsig#';
const ETSI = 'http://uri.etsi.org/01903/v1.3.2#';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
// Inclusive C14N renders the namespaces in scope on a signed subtree's top element.
const NAMESPACES = `xmlns:ds="${DS}" xmlns:etsi="${ETSI}"`;

export type SigningKey = { privateKeyPem: string; certificatePem: string };

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('base64');
const wrap76 = (base64: string) => base64.match(/.{1,76}/g)!.join('\n');
const id = () => String(randomInt(100_000, 1_000_000));

// Reversed and joined with "," and no space, as the Java tools SRI was built against.
// An attribute forge has no short name for keeps its OID.
function issuerName(certificate: forge.pki.Certificate): string {
  return certificate.issuer.attributes
    .slice()
    .reverse()
    .map((attribute) => `${attribute.shortName ?? attribute.type}=${String(attribute.value)}`)
    .join(',');
}

export function signXml(xml: string, key: SigningKey, now: Date): string {
  const certificate = forge.pki.certificateFromPem(key.certificatePem);
  if (now < certificate.validity.notBefore || now > certificate.validity.notAfter)
    throw new DomainError('CERTIFICATE_EXPIRED', 'The signing certificate is not valid today', {
      notAfter: certificate.validity.notAfter.toISOString(),
    });

  const body = xml.startsWith(XML_DECLARATION)
    ? xml.slice(XML_DECLARATION.length).trimStart()
    : xml;
  const der = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(),
    'binary',
  );
  // A serial is up to 20 bytes: a Number would round it.
  const serial = BigInt(`0x${certificate.serialNumber}`).toString();

  const signatureId = `Signature${id()}`;
  const signedPropertiesId = `${signatureId}-SignedProperties${id()}`;
  const referenceId = `Reference-ID${id()}`;

  const signedProperties =
    `<etsi:SignedProperties Id="${signedPropertiesId}">` +
    '<etsi:SignedSignatureProperties>' +
    `<etsi:SigningTime>${ecuadorDateTime(now)}</etsi:SigningTime>` +
    '<etsi:SigningCertificate><etsi:Cert><etsi:CertDigest>' +
    `<ds:DigestMethod Algorithm="${SHA256}"></ds:DigestMethod>` +
    `<ds:DigestValue>${sha256(der)}</ds:DigestValue>` +
    '</etsi:CertDigest><etsi:IssuerSerial>' +
    `<ds:X509IssuerName>${escapeText(issuerName(certificate))}</ds:X509IssuerName>` +
    `<ds:X509SerialNumber>${serial}</ds:X509SerialNumber>` +
    '</etsi:IssuerSerial></etsi:Cert></etsi:SigningCertificate>' +
    '</etsi:SignedSignatureProperties>' +
    '<etsi:SignedDataObjectProperties>' +
    `<etsi:DataObjectFormat ObjectReference="#${escapeAttribute(referenceId)}">` +
    '<etsi:Description>contenido comprobante</etsi:Description>' +
    '<etsi:MimeType>text/xml</etsi:MimeType>' +
    '</etsi:DataObjectFormat></etsi:SignedDataObjectProperties>' +
    '</etsi:SignedProperties>';

  const signedInfo =
    `<ds:SignedInfo Id="Signature-SignedInfo${id()}">` +
    '\n<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></ds:CanonicalizationMethod>' +
    '\n<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></ds:SignatureMethod>' +
    `\n<ds:Reference Id="${referenceId}" URI="#comprobante">` +
    '\n<ds:Transforms>' +
    `\n<ds:Transform Algorithm="${DS}enveloped-signature"></ds:Transform>` +
    '\n</ds:Transforms>' +
    `\n<ds:DigestMethod Algorithm="${SHA256}"></ds:DigestMethod>` +
    `\n<ds:DigestValue>${sha256(body)}</ds:DigestValue>` +
    '\n</ds:Reference>' +
    `\n<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#${signedPropertiesId}">` +
    `\n<ds:DigestMethod Algorithm="${SHA256}"></ds:DigestMethod>` +
    `\n<ds:DigestValue>${sha256(signedProperties.replace('<etsi:SignedProperties', `<etsi:SignedProperties ${NAMESPACES}`))}</ds:DigestValue>` +
    '\n</ds:Reference>' +
    '\n</ds:SignedInfo>';

  const signatureValue = createSign('RSA-SHA256')
    .update(signedInfo.replace('<ds:SignedInfo', `<ds:SignedInfo ${NAMESPACES}`))
    .sign(key.privateKeyPem, 'base64');

  const pem = forge.pki.certificateToPem(certificate);
  const certificateBase64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');

  const signature =
    `<ds:Signature ${NAMESPACES} Id="${signatureId}">` +
    `\n${signedInfo}` +
    `\n<ds:SignatureValue Id="SignatureValue${id()}">${wrap76(signatureValue)}\n</ds:SignatureValue>` +
    `\n<ds:KeyInfo>\n<ds:X509Data>\n<ds:X509Certificate>\n${wrap76(certificateBase64)}\n</ds:X509Certificate>\n</ds:X509Data>\n</ds:KeyInfo>` +
    `\n<ds:Object Id="${signatureId}-Object${id()}">` +
    `<etsi:QualifyingProperties Target="#${signatureId}">${signedProperties}</etsi:QualifyingProperties>` +
    '</ds:Object>' +
    '</ds:Signature>';

  // Enveloped: the last child of the root, after infoAdicional.
  const close = body.lastIndexOf('</');
  return `${XML_DECLARATION}\n${body.slice(0, close)}${signature}${body.slice(close)}`;
}
