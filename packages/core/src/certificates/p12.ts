import forge from 'node-forge';
import { DomainError } from '../kernel';

export type ParsedCertificate = {
  privateKeyPem: string;
  certificatePem: string;
  fingerprint: string;
  subjectName: string;
  issuerName: string;
  notBefore: Date;
  notAfter: Date;
  // 10- to 13-digit numbers found in the subject and extensions: RUC, cédula.
  identifiers: string[];
};

const fail = (code: string, message: string): never => {
  throw new DomainError(code, message);
};

function strings(node: forge.asn1.Asn1, out: string[] = []): string[] {
  if (Array.isArray(node.value)) node.value.forEach((child) => strings(child, out));
  else if (typeof node.value === 'string') out.push(node.value);
  return out;
}

// Every CA stores the RUC differently (Security Data: OID 1.3.6.1.4.1.37746.3.11),
// so this collects numbers from the subject and all extensions instead of
// reading one CA's field.
function identifiersOf(cert: forge.pki.Certificate): string[] {
  const values = cert.subject.attributes.map((attribute) => String(attribute.value));
  for (const extension of cert.extensions as { value?: string }[]) {
    if (typeof extension.value !== 'string') continue;
    try {
      strings(forge.asn1.fromDer(extension.value), values);
    } catch {
      values.push(extension.value);
    }
  }
  return [...new Set(values.flatMap((value) => value.match(/\d{10,13}/g) ?? []))];
}

// node-forge types getField as any.
const field = (name: forge.pki.Certificate['subject'], short: string): string | undefined => {
  const attribute = name.getField(short) as { value?: unknown } | null;
  return typeof attribute?.value === 'string' ? attribute.value : undefined;
};

// Works for any CA: the signing certificate is the one whose public key matches
// a private key in the file.
export function parseP12(file: Uint8Array, password: string, now: Date): ParsedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.binary.raw.encode(file));
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    } catch {
      return fail('CERTIFICATE_PASSWORD_INVALID', 'Wrong certificate password');
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    return fail('CERTIFICATE_INVALID', 'Not a PKCS#12 file');
  }

  const bagsOf = (type: string) => p12.getBags({ bagType: type })[type] ?? [];
  const keys = [...bagsOf(forge.pki.oids.pkcs8ShroudedKeyBag!), ...bagsOf(forge.pki.oids.keyBag!)]
    .map((bag) => bag.key)
    .filter((key): key is forge.pki.rsa.PrivateKey => Boolean(key));
  const certs = bagsOf(forge.pki.oids.certBag!)
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => Boolean(cert));

  let pair: { key: forge.pki.rsa.PrivateKey; cert: forge.pki.Certificate } | undefined;
  for (const cert of certs) {
    const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
    const key = keys.find((candidate) => publicKey.n?.equals(candidate.n));
    if (key) pair = { key, cert };
  }
  if (!pair)
    return fail('CERTIFICATE_KEY_NOT_FOUND', 'No signing key matches a certificate in the file');

  const { key, cert } = pair;
  if (now < cert.validity.notBefore || now > cert.validity.notAfter) {
    fail('CERTIFICATE_EXPIRED', 'The certificate is not valid today');
  }

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return {
    privateKeyPem: forge.pki.privateKeyToPem(key),
    certificatePem: forge.pki.certificateToPem(cert),
    fingerprint: forge.md.sha256.create().update(der).digest().toHex(),
    subjectName: field(cert.subject, 'CN') ?? 'Unknown',
    issuerName: field(cert.issuer, 'O') ?? field(cert.issuer, 'CN') ?? 'Unknown',
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    identifiers: identifiersOf(cert),
  };
}

// FR-ONB-3: the RUC itself, or for a person (third digit 0 to 5) their cédula,
// which is the RUC's first ten digits.
export function certificateMatchesRuc(identifiers: readonly string[], ruc: string): boolean {
  if (identifiers.includes(ruc)) return true;
  const person = Number(ruc[2]) < 6;
  return person && identifiers.includes(ruc.slice(0, 10));
}
